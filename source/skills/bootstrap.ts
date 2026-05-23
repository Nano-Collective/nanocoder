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
	const flatSkills: Skill[] = [
		...synthesizeCommandSkills(opts.commandLoader),
		...(await synthesizeSubagentSkills(opts.subagentLoader)),
		...synthesizeToolSkills(opts.toolManager),
	];

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

export function summarizeBoot(result: SkillBootResult): string {
	const parts: string[] = [];
	if (result.skills.length === 0) {
		parts.push('No skills found.');
	} else {
		const bundle = result.skills.filter(
			s => s.source.shape === 'bundle',
		).length;
		const flat = result.skills.length - bundle;
		parts.push(
			`Loaded ${result.skills.length} skills (${flat} flat, ${bundle} bundles).`,
		);
	}
	if (result.loadErrors.length > 0) {
		parts.push(`${result.loadErrors.length} load errors.`);
	}
	if (result.registration.collisions.length > 0) {
		parts.push(`${result.registration.collisions.length} collisions.`);
	}
	if (result.registration.subscriptionIds.length > 0) {
		parts.push(
			`${result.registration.subscriptionIds.length} subscriptions registered.`,
		);
	}
	return parts.join(' ');
}

export type {SkillCollision};
