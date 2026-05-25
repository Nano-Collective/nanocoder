/**
 * One-call boot helper that drives the full skill pipeline:
 *
 *   1. Legacy loaders populate the existing registries:
 *      - CustomCommandLoader.loadCommands() (handles namespace recursion,
 *        directory-as-command, aliases, resources/)
 *      - SubagentLoader.initialize() (built-in + user + project layering)
 *      - ToolManager.initializeCustomTools() (file-based custom tools)
 *   2. Frontmatter `subscribe:` blocks on flat-form files are subscribed
 *      with the event router (the legacy loaders now carry `subscribe`
 *      through, so flat-form triggers fire end-to-end).
 *   3. BundleLoader loads bundle-form skills under .nanocoder/skills/.
 *   4. Registrar fans bundle members into the same registries the legacy
 *      loaders use, and subscribes their triggers with the event router.
 *   5. Skill envelopes are synthesized for every loaded member so
 *      `/skills` lists everything regardless of form.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 21.
 */

import {existsSync} from 'node:fs';
import {join} from 'node:path';
import type {CustomCommandLoader} from '@/custom-commands/loader';
import type {EventRouter} from '@/events/event-router';
import {commandToSkill, subagentToSkill, toolToSkill} from '@/skills/adapters';
import {BundleLoader, type SkillLoadError} from '@/skills/bundle-loader';
import {
	type RegisterResult,
	registerSkillSubscriptions,
	registerSkills,
	type SkillCollision,
} from '@/skills/registrar';
import {setLoadedSkills} from '@/skills/skill-registry';
import type {SubagentLoader} from '@/subagents/subagent-loader';
import {SubagentLoadPriority} from '@/subagents/types';
import type {ToolManager} from '@/tools/tool-manager';
import type {Skill, SkillPriority} from '@/types/skills';

export interface SkillBootResult {
	skills: Skill[];
	loadErrors: SkillLoadError[];
	registration: RegisterResult;
	deprecations: string[];
}

export interface SkillBootOptions {
	projectRoot: string;
	toolManager: ToolManager;
	commandLoader: CustomCommandLoader;
	subagentLoader: SubagentLoader;
	eventRouter: EventRouter;
	/** Optional built-in bundle directory. */
	builtInBundleRoot?: string;
}

export async function bootSkillPipeline(
	opts: SkillBootOptions,
): Promise<SkillBootResult> {
	// === Legacy loaders populate their registries ===========================
	const loaderErrors: SkillLoadError[] = [];

	try {
		opts.commandLoader.loadCommands();
	} catch (err) {
		loaderErrors.push({
			bundlePath: opts.projectRoot,
			message: `Failed to load custom commands: ${err instanceof Error ? err.message : String(err)}`,
		});
	}

	try {
		await opts.subagentLoader.initialize();
		// Per-file parse errors are collected inside the loader; drain them
		// so the daemon's log surface (or the TUI's chat queue) can show them.
		for (const e of opts.subagentLoader.drainLoadErrors()) {
			loaderErrors.push({
				bundlePath: opts.projectRoot,
				filePath: e.filePath,
				message: e.message,
			});
		}
	} catch (err) {
		loaderErrors.push({
			bundlePath: opts.projectRoot,
			message: `Failed to initialize subagents: ${err instanceof Error ? err.message : String(err)}`,
		});
	}

	try {
		const customToolResult = opts.toolManager.initializeCustomTools(
			opts.projectRoot,
		);
		for (const e of customToolResult.errors) {
			loaderErrors.push({
				bundlePath: opts.projectRoot,
				filePath: e.file,
				message: e.error,
			});
		}
	} catch (err) {
		loaderErrors.push({
			bundlePath: opts.projectRoot,
			message: `Failed to load custom tools: ${err instanceof Error ? err.message : String(err)}`,
		});
	}

	// === Synthesize skill envelopes from the populated registries ===========
	const rawFlatSkills: Skill[] = [
		...synthesizeCommandSkills(opts.commandLoader),
		...(await synthesizeSubagentSkills(opts.subagentLoader)),
		...synthesizeToolSkills(opts.toolManager),
	];

	// Cross-kind flat-skill name collisions: a command "foo" and a tool "foo"
	// would both surface in `/skills` under the same name. Detect, report,
	// and drop the later one. The underlying registries (commands, tools,
	// agents) are unaffected - those still allow same-name across kinds and
	// the original member is reachable via `/foo` or the tool invocation.
	const {kept: flatSkills, collisions: flatNameCollisions} =
		dedupeFlatSkills(rawFlatSkills);

	// === Subscribe flat-form skill triggers =================================
	// Members already live in the legacy registries; we only need to wire
	// their frontmatter-declared `subscribe:` blocks through the router.
	const flatSubscriptions = registerSkillSubscriptions(
		flatSkills,
		opts.eventRouter,
	);

	// === BundleLoader loads bundle skills ===================================
	const bundle = await new BundleLoader(
		opts.projectRoot,
		opts.builtInBundleRoot,
	).load();

	// === Registrar registers bundles (members + subscriptions) ==============
	const bundleRegistration = registerSkills(bundle.skills, {
		toolManager: opts.toolManager,
		commandLoader: opts.commandLoader,
		subagentLoader: opts.subagentLoader,
		eventRouter: opts.eventRouter,
	});

	const registration: RegisterResult = {
		registered: bundleRegistration.registered,
		collisions: [
			...flatNameCollisions,
			...flatSubscriptions.collisions,
			...bundleRegistration.collisions,
		],
		subscriptionIds: [
			...flatSubscriptions.subscriptionIds,
			...bundleRegistration.subscriptionIds,
		],
	};

	const skills: Skill[] = [...flatSkills, ...bundle.skills];
	const deprecations = detectDeprecations(opts.projectRoot);

	const result: SkillBootResult = {
		skills,
		loadErrors: [...loaderErrors, ...bundle.errors],
		registration,
		deprecations,
	};
	setLoadedSkills({
		skills,
		loadErrors: result.loadErrors,
		collisions: registration.collisions,
	});
	return result;
}

/**
 * Drop cross-kind name collisions among flat-form skills. Two synthesized
 * skills sharing a `name` would both surface in `/skills` under the same
 * heading - we keep the first occurrence (commands win over agents over
 * tools, matching the synthesizer order) and emit a `SkillCollision` for
 * each duplicate so it lands in the daemon log / chat queue.
 */
function dedupeFlatSkills(skills: Skill[]): {
	kept: Skill[];
	collisions: SkillCollision[];
} {
	const seen = new Map<string, Skill>();
	const kept: Skill[] = [];
	const collisions: SkillCollision[] = [];
	for (const skill of skills) {
		const first = seen.get(skill.name);
		if (first) {
			collisions.push({
				skill: skill.name,
				kind: kindOf(skill),
				name: skill.name,
				message: `Flat skill "${skill.name}" (${kindOf(skill)}) collides with already-loaded "${first.name}" (${kindOf(first)}). Keeping the first; the new entry is dropped from /skills.`,
			});
			continue;
		}
		seen.set(skill.name, skill);
		kept.push(skill);
	}
	return {kept, collisions};
}

function kindOf(skill: Skill): 'command' | 'agent' | 'tool' {
	if (skill.commands && skill.commands.length > 0) return 'command';
	if (skill.subagent) return 'agent';
	return 'tool';
}

function synthesizeCommandSkills(loader: CustomCommandLoader): Skill[] {
	const out: Skill[] = [];
	for (const command of loader.getAllCommands()) {
		const priority: SkillPriority =
			command.source === 'project'
				? 'project'
				: command.source === 'personal'
					? 'personal'
					: 'project';
		out.push(
			commandToSkill(command, {
				filePath: command.path,
				priority,
				subscribe: command.subscribe,
			}),
		);
	}
	return out;
}

async function synthesizeSubagentSkills(
	loader: SubagentLoader,
): Promise<Skill[]> {
	const out: Skill[] = [];
	const configs = await loader.listSubagents();
	for (const config of configs) {
		const priority: SkillPriority =
			config.source.priority === SubagentLoadPriority.Project
				? 'project'
				: config.source.priority === SubagentLoadPriority.User
					? 'personal'
					: 'built-in';
		out.push(
			subagentToSkill(config, {
				filePath: config.source.filePath ?? '(built-in)',
				priority,
				subscribe: config.subscribe,
			}),
		);
	}
	return out;
}

function synthesizeToolSkills(manager: ToolManager): Skill[] {
	const out: Skill[] = [];
	for (const name of manager.getCustomToolNames()) {
		const info = manager.getCustomToolInfo(name);
		const entry = manager.getToolEntry(name);
		if (!info || !entry) continue;
		const priority: SkillPriority =
			info.source === 'project' ? 'project' : 'personal';
		out.push(
			toolToSkill(entry, {
				filePath: info.filePath,
				priority,
				subscribe: info.subscribe,
			}),
		);
	}
	return out;
}

function detectDeprecations(projectRoot: string): string[] {
	const warnings: string[] = [];
	const schedulesJson = join(projectRoot, '.nanocoder', 'schedules.json');
	if (existsSync(schedulesJson)) {
		warnings.push(
			`.nanocoder/schedules.json is deprecated. Move each entry into the targeted command's frontmatter as a "schedule.cron" subscription, or into a skill bundle's manifest. Run \`nanocoder daemon start\` to enable scheduled runs.`,
		);
	}
	return warnings;
}

export type {SkillCollision};
