/**
 * Fan a list of resolved `Skill`s out into the existing command, subagent,
 * and tool registries, and subscribe each declared trigger with the event
 * router.
 *
 * The registrar is the only place that bridges the unified skill model
 * with the legacy registries: every downstream consumer (`/tools`,
 * `/help`, mode filtering, the agent tool, the slash-command dispatcher)
 * keeps touching its existing registry, unaware that a skill provided the
 * member.
 *
 * Collision posture matches the custom-tools loader: name clashes inside
 * the destination registry are hard errors (return value, not throw) so
 * the caller can report them all at once instead of failing the boot on
 * the first one.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 12.
 */

import type {CustomCommandLoader} from '@/custom-commands/loader';
import type {EventRouter} from '@/events/event-router';
import type {
	FileChangedFilter,
	ScheduleCronFilter,
	Subscription,
	SubscriptionId,
	SubscriptionSource,
} from '@/events/types';
import type {SubagentLoader} from '@/subagents/subagent-loader';
import type {SubagentConfigWithSource} from '@/subagents/types';
import {SubagentLoadPriority} from '@/subagents/types';
import type {ToolManager} from '@/tools/tool-manager';
import type {
	Skill,
	SkillMemberKind,
	SkillMemberRef,
	SkillPriority,
	SkillTrigger,
} from '@/types/skills';
import {formatError} from '@/utils/error-formatter';

export interface SkillCollision {
	skill: string;
	kind: SkillMemberKind | 'subscription';
	name: string;
	message: string;
}

export interface RegistrarDependencies {
	toolManager: ToolManager;
	commandLoader: CustomCommandLoader;
	subagentLoader: SubagentLoader;
	eventRouter: EventRouter;
}

export interface RegisterResult {
	registered: string[];
	collisions: SkillCollision[];
	subscriptionIds: SubscriptionId[];
}

const TARGET_REGEX = /^(command|agent|tool):([a-z][a-z0-9_-]*)$/;

export function registerSkills(
	skills: Skill[],
	deps: RegistrarDependencies,
): RegisterResult {
	const collisions: SkillCollision[] = [];
	const registered: string[] = [];
	const subscriptionIds: SubscriptionId[] = [];

	for (const skill of skills) {
		const skillCollisions: SkillCollision[] = [];

		if (skill.commands) {
			for (const member of skill.commands) {
				const c = member.command;
				if (!deps.commandLoader.registerExternal(c)) {
					const existing = deps.commandLoader.getCommand(c.fullName);
					skillCollisions.push({
						skill: skill.name,
						kind: 'command',
						name: c.fullName,
						message: `Command "${c.fullName}" from ${member.filePath} collides with existing command at ${existing?.path ?? '(unknown)'}.`,
					});
				}
			}
		}

		if (skill.subagent) {
			const config: SubagentConfigWithSource = {
				...skill.subagent.subagent,
				ownerSkill: skill.name,
				source: {
					priority: subagentPriorityFor(skill.source.priority),
					filePath: skill.subagent.filePath,
					isBuiltIn: skill.source.priority === 'built-in',
				},
			};
			if (!deps.subagentLoader.registerExternal(config)) {
				skillCollisions.push({
					skill: skill.name,
					kind: 'agent',
					name: config.name,
					message: `Subagent "${config.name}" from ${skill.subagent.filePath} collides with an already-registered subagent.`,
				});
			}
		}

		if (skill.tools) {
			for (const member of skill.tools) {
				if (deps.toolManager.hasTool(member.tool.name)) {
					skillCollisions.push({
						skill: skill.name,
						kind: 'tool',
						name: member.tool.name,
						message: `Tool "${member.tool.name}" from ${member.filePath} collides with a built-in, MCP, or already-registered tool.`,
					});
					continue;
				}
				deps.toolManager.registerSkillTool({
					...member.tool,
					ownerSkill: skill.name,
					scoped: skill.toolsVisibility === 'scoped',
				});
			}
		}

		if (skillCollisions.length > 0) {
			collisions.push(...skillCollisions);
		}

		if (skill.subscribe) {
			const subResult = subscribeSkillTriggers(skill, deps.eventRouter);
			subscriptionIds.push(...subResult.subscriptionIds);
			skillCollisions.push(...subResult.collisions);
			if (subResult.collisions.length > 0) {
				collisions.push(...subResult.collisions);
			}
		}

		registered.push(skill.name);
	}

	// dedupe: a skill with both member collisions and subscription collisions
	// may have been pushed twice above. Normalize the list.
	const unique = new Map<string, SkillCollision>();
	for (const c of collisions) unique.set(`${c.skill}:${c.kind}:${c.name}`, c);

	return {
		registered,
		collisions: [...unique.values()],
		subscriptionIds,
	};
}

/**
 * Walk a skill's `subscribe[]` and register each entry with the event
 * router. Returns the subscription IDs that were registered plus any
 * per-entry collisions. Used internally by `registerSkills` (for bundles)
 * and by `registerSkillSubscriptions` (for flat-form skills whose members
 * already live in the legacy registries).
 */
function subscribeSkillTriggers(
	skill: Skill,
	eventRouter: EventRouter,
): {subscriptionIds: SubscriptionId[]; collisions: SkillCollision[]} {
	const subscriptionIds: SubscriptionId[] = [];
	const collisions: SkillCollision[] = [];
	if (!skill.subscribe) return {subscriptionIds, collisions};

	skill.subscribe.forEach((trig, index) => {
		const subscription = buildSubscription(skill, trig, index);
		if (!subscription) {
			collisions.push({
				skill: skill.name,
				kind: 'subscription',
				name: trig.target ?? `subscribe[${index}]`,
				message: `subscribe[${index}].target "${trig.target ?? ''}" is malformed.`,
			});
			return;
		}
		try {
			eventRouter.subscribe(subscription);
			subscriptionIds.push(subscription.id);
		} catch (err) {
			collisions.push({
				skill: skill.name,
				kind: 'subscription',
				name: subscription.id,
				message: formatError(err),
			});
		}
	});

	return {subscriptionIds, collisions};
}

/**
 * Subscribe many skills' triggers at once. The bootstrap calls this for
 * flat-form skills (whose members already live in the legacy registries),
 * so we don't re-register members and don't produce false collisions.
 */
export function registerSkillSubscriptions(
	skills: Skill[],
	eventRouter: EventRouter,
): {subscriptionIds: SubscriptionId[]; collisions: SkillCollision[]} {
	const subscriptionIds: SubscriptionId[] = [];
	const collisions: SkillCollision[] = [];
	for (const skill of skills) {
		const r = subscribeSkillTriggers(skill, eventRouter);
		subscriptionIds.push(...r.subscriptionIds);
		collisions.push(...r.collisions);
	}
	return {subscriptionIds, collisions};
}

/**
 * Resolve a single-file skill's frontmatter `subscribe:` entry to its
 * implicit member target. A single-file skill has exactly one of command
 * / subagent / tools (the tools case is at most one for a flat skill -
 * bundles can have many but always set target explicitly).
 */
function resolveImplicitTarget(skill: Skill): SkillMemberRef | null {
	if (skill.commands && skill.commands.length === 1) {
		const only = skill.commands[0];
		if (only) return {kind: 'command', name: only.command.name};
	}
	if (skill.subagent) {
		return {kind: 'agent', name: skill.subagent.subagent.name};
	}
	if (skill.tools && skill.tools.length === 1) {
		const tool = skill.tools[0];
		if (tool) return {kind: 'tool', name: tool.tool.name};
	}
	return null;
}

function subagentPriorityFor(skill: SkillPriority): SubagentLoadPriority {
	switch (skill) {
		case 'built-in':
			return SubagentLoadPriority.BuiltIn;
		case 'personal':
			return SubagentLoadPriority.User;
		case 'project':
			return SubagentLoadPriority.Project;
	}
}

function buildSubscription(
	skill: Skill,
	trig: SkillTrigger,
	index: number,
): Subscription | null {
	// Manifest-form subscriptions carry an explicit target. Frontmatter-form
	// subscriptions on single-file skills omit target - we resolve it to the
	// skill's single member.
	const explicit = trig.target;
	let kind: SkillMemberKind;
	let name: string;

	if (explicit) {
		const match = TARGET_REGEX.exec(explicit);
		if (!match) return null;
		kind = match[1] as SkillMemberKind;
		const matched = match[2];
		if (!matched) return null;
		name = matched;
	} else {
		const implicit = resolveImplicitTarget(skill);
		if (!implicit) return null;
		kind = implicit.kind;
		name = implicit.name;
	}

	const source: SubscriptionSource =
		skill.source.shape === 'bundle' ? 'manifest' : 'frontmatter';
	const id = `${skill.name}:${trig.kind}:${kind}:${name}:${index}`;

	const base = {
		id,
		target: {kind, name},
		source,
		ownerSkill: skill.name,
		...(trig.confirm !== undefined ? {confirm: trig.confirm} : {}),
	};

	if (trig.kind === 'file.changed') {
		const filter: FileChangedFilter = {};
		if (trig.paths) filter.paths = trig.paths;
		if (trig.eventKinds) filter.eventKinds = trig.eventKinds;
		return {
			...base,
			kind: 'file.changed',
			...(Object.keys(filter).length > 0 ? {filter} : {}),
		};
	}
	if (trig.kind === 'schedule.cron') {
		const filter: ScheduleCronFilter = {cron: trig.cron};
		return {
			...base,
			kind: 'schedule.cron',
			filter,
		};
	}
	return null;
}
