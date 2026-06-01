/**
 * Discover and load bundle-form skills from the three priority locations:
 *
 *   1. project   `<projectRoot>/.nanocoder/skills/`
 *   2. personal  `<getConfigPath()>/skills/`
 *   3. built-in  `source/skills/built-in/` (if shipped)
 *
 * Within a layer, duplicate skill names are an error. Across layers, project
 * shadows personal shadows built-in by `Skill.name` (silently - matches
 * `SubagentLoader`).
 *
 * Each bundle is a subdirectory containing a `skill.yaml` plus optional
 * `commands/`, `agents/`, `tools/` subdirs. Member files use the existing
 * per-kind parsers; the bundle's tools_visibility defaults to `scoped`
 * (only its own subagent sees them) unless the manifest sets `global`.
 *
 * Subscription resolution merges manifest-declared and
 * frontmatter-declared entries into one list, rejecting duplicates by
 * `(kind, target)` pair.
 */

import {existsSync, readdirSync} from 'node:fs';
import {basename, join} from 'node:path';
import {getConfigPath} from '@/config/paths';
import {parseCommandFile} from '@/custom-commands/parser';
import {buildToolEntry} from '@/custom-tools/build-tool';
import {parseCustomToolFile} from '@/custom-tools/parser';
import {
	parseSkillManifest,
	SkillManifestParseError,
} from '@/skills/manifest-parser';
import {parseSubagentMarkdown} from '@/subagents/markdown-parser';
import type {SubagentConfig} from '@/subagents/types';
import type {CustomCommand} from '@/types/commands';
import type {
	Skill,
	SkillCommandMember,
	SkillManifest,
	SkillPriority,
	SkillSubagentMember,
	SkillToolMember,
	SkillTrigger,
} from '@/types/skills';
import {formatError} from '@/utils/error-formatter';
import {loadMdDir} from '@/utils/load-md-dir';

export interface SkillLoadError {
	bundlePath: string;
	filePath?: string;
	message: string;
}

export interface BundleLoadResult {
	skills: Skill[];
	errors: SkillLoadError[];
}

interface LoadedMember<T> {
	member: T;
	frontmatterSubscribe?: SkillTrigger[];
}

const TARGET_REGEX = /^(command|agent|tool):([a-z][a-z0-9_-]*)$/;

export class BundleLoader {
	constructor(
		private readonly projectRoot: string,
		private readonly builtInRoot?: string,
	) {}

	async load(): Promise<BundleLoadResult> {
		const errors: SkillLoadError[] = [];
		const layers: Array<{root: string; priority: SkillPriority}> = [];

		if (this.builtInRoot) {
			layers.push({root: this.builtInRoot, priority: 'built-in'});
		}
		layers.push({
			root: join(getConfigPath(), 'skills'),
			priority: 'personal',
		});
		layers.push({
			root: join(this.projectRoot, '.nanocoder', 'skills'),
			priority: 'project',
		});

		const byName = new Map<string, Skill>();
		for (const {root, priority} of layers) {
			const layer = await this.scanLayer(root, priority);
			errors.push(...layer.errors);
			for (const skill of layer.skills) {
				byName.set(skill.name, skill);
			}
		}

		return {skills: [...byName.values()], errors};
	}

	private async scanLayer(
		root: string,
		priority: SkillPriority,
	): Promise<BundleLoadResult> {
		if (!existsSync(root)) return {skills: [], errors: []};

		const errors: SkillLoadError[] = [];
		const skills: Skill[] = [];
		const namesSeen = new Set<string>();

		let entries: string[];
		try {
			entries = readdirSync(root);
		} catch (err) {
			errors.push({bundlePath: root, message: errorMessage(err)});
			return {skills, errors};
		}

		for (const entry of entries) {
			const bundlePath = join(root, entry);
			const manifestPath = join(bundlePath, 'skill.yaml');
			if (!existsSync(manifestPath)) continue;

			const result = await this.loadBundle(bundlePath, manifestPath, priority);
			errors.push(...result.errors);
			if (!result.skill) continue;

			if (namesSeen.has(result.skill.name)) {
				errors.push({
					bundlePath,
					message: `Duplicate skill name "${result.skill.name}" in ${priority} layer - keeping the first.`,
				});
				continue;
			}
			namesSeen.add(result.skill.name);
			skills.push(result.skill);
		}

		return {skills, errors};
	}

	private async loadBundle(
		bundlePath: string,
		manifestPath: string,
		priority: SkillPriority,
	): Promise<{skill: Skill | null; errors: SkillLoadError[]}> {
		const errors: SkillLoadError[] = [];

		let manifest: SkillManifest;
		try {
			manifest = parseSkillManifest(manifestPath);
		} catch (err) {
			const message =
				err instanceof SkillManifestParseError
					? err.message
					: errorMessage(err);
			errors.push({bundlePath, filePath: manifestPath, message});
			return {skill: null, errors};
		}

		const commandResult = await loadCommandMembers(bundlePath, manifest.name);
		errors.push(...commandResult.errors);

		const subagentResult = await loadSubagentMember(bundlePath);
		errors.push(...subagentResult.errors);

		const toolsResult = await loadToolMembers(bundlePath, this.projectRoot);
		errors.push(...toolsResult.errors);

		const memberRefs = collectMemberRefs(
			commandResult.loaded,
			subagentResult.loaded?.member,
			toolsResult.loaded,
		);

		const subscribeResult = mergeSubscriptions(
			manifest.subscribe,
			commandResult.loaded,
			subagentResult.loaded,
			toolsResult.loaded,
			memberRefs,
		);
		errors.push(
			...subscribeResult.errors.map(message => ({bundlePath, message})),
		);

		const skill: Skill = {
			name: manifest.name,
			description: manifest.description,
			source: {
				priority,
				shape: 'bundle',
				rootPath: bundlePath,
			},
			toolsVisibility: manifest.tools_visibility?.default ?? 'scoped',
		};
		if (manifest.version) skill.version = manifest.version;
		if (manifest.author) skill.author = manifest.author;
		if (manifest.tags) skill.tags = manifest.tags;
		if (commandResult.loaded.length > 0) {
			skill.commands = commandResult.loaded.map(l => l.member);
		}
		if (subagentResult.loaded) skill.subagent = subagentResult.loaded.member;
		if (toolsResult.loaded.length > 0) {
			skill.tools = toolsResult.loaded.map(l => l.member);
		}
		if (subscribeResult.subscriptions.length > 0) {
			skill.subscribe = subscribeResult.subscriptions;
		}

		return {skill, errors};
	}
}

async function loadCommandMembers(
	bundlePath: string,
	bundleName: string,
): Promise<{
	loaded: LoadedMember<SkillCommandMember>[];
	errors: SkillLoadError[];
}> {
	const dir = join(bundlePath, 'commands');
	const {entries, errors: walkErrors} = await loadMdDir(dir, filePath =>
		parseCommandFile(filePath),
	);
	const errors: SkillLoadError[] = walkErrors.map(e => ({
		bundlePath,
		filePath: e.filePath,
		message: e.error,
	}));

	const loaded: LoadedMember<SkillCommandMember>[] = [];
	for (const entry of entries) {
		errors.push(
			...rejectExplicitTarget(
				entry.parsed.subscribe,
				entry.filePath,
				bundlePath,
			),
		);
		const fileName = basename(entry.filePath, '.md');
		// Auto-namespace under the bundle name: `commands/status.md` in bundle
		// `k8s` invokes as `/k8s:status`. Shortcut: if the file basename
		// equals the bundle name (`commands/k8s.md`), use bare `/k8s` so
		// single-command bundles named after themselves stay clean.
		const fullName =
			fileName === bundleName ? fileName : `${bundleName}:${fileName}`;
		const namespace = fileName === bundleName ? undefined : bundleName;
		const command: CustomCommand = {
			name: fileName,
			path: entry.filePath,
			namespace,
			fullName,
			metadata: entry.parsed.metadata,
			content: entry.parsed.content,
		};
		loaded.push({
			member: {command, filePath: entry.filePath},
			frontmatterSubscribe: entry.parsed.subscribe,
		});
	}
	return {loaded, errors};
}

async function loadSubagentMember(bundlePath: string): Promise<{
	loaded?: LoadedMember<SkillSubagentMember>;
	errors: SkillLoadError[];
}> {
	const dir = join(bundlePath, 'agents');
	const {entries, errors: walkErrors} = await loadMdDir(dir, filePath =>
		parseSubagentMarkdown(filePath),
	);
	const errors: SkillLoadError[] = walkErrors.map(e => ({
		bundlePath,
		filePath: e.filePath,
		message: e.error,
	}));

	if (entries.length === 0) return {errors};
	if (entries.length > 1) {
		const extras = entries
			.slice(1)
			.map(e => basename(e.filePath))
			.join(', ');
		errors.push({
			bundlePath,
			message: `agents/ has multiple .md files (only one subagent per bundle is supported): ignoring ${extras}.`,
		});
	}

	const first = entries[0];
	if (!first) return {errors};
	errors.push(
		...rejectExplicitTarget(first.parsed.subscribe, first.filePath, bundlePath),
	);

	const subagent: SubagentConfig = first.parsed.config;
	return {
		loaded: {
			member: {subagent, filePath: first.filePath},
			frontmatterSubscribe: first.parsed.subscribe,
		},
		errors,
	};
}

async function loadToolMembers(
	bundlePath: string,
	projectRoot: string,
): Promise<{
	loaded: LoadedMember<SkillToolMember>[];
	errors: SkillLoadError[];
}> {
	const dir = join(bundlePath, 'tools');
	const {entries, errors: walkErrors} = await loadMdDir(dir, filePath =>
		parseCustomToolFile(filePath),
	);
	const errors: SkillLoadError[] = walkErrors.map(e => ({
		bundlePath,
		filePath: e.filePath,
		message: e.error,
	}));

	const loaded: LoadedMember<SkillToolMember>[] = [];
	for (const entry of entries) {
		try {
			const toolEntry = buildToolEntry(
				{
					metadata: entry.parsed.metadata,
					body: entry.parsed.body,
					filePath: entry.filePath,
					source: 'project',
				},
				projectRoot,
			);
			errors.push(
				...rejectExplicitTarget(
					entry.parsed.subscribe,
					entry.filePath,
					bundlePath,
				),
			);
			loaded.push({
				member: {tool: toolEntry, filePath: entry.filePath},
				frontmatterSubscribe: entry.parsed.subscribe,
			});
		} catch (err) {
			errors.push({
				bundlePath,
				filePath: entry.filePath,
				message: errorMessage(err),
			});
		}
	}
	return {loaded, errors};
}

function rejectExplicitTarget(
	subscribe: SkillTrigger[] | undefined,
	filePath: string,
	bundlePath: string,
): SkillLoadError[] {
	if (!subscribe) return [];
	const errors: SkillLoadError[] = [];
	subscribe.forEach((trig, i) => {
		if (trig.target !== undefined) {
			errors.push({
				bundlePath,
				filePath,
				message: `subscribe[${i}].target must be omitted in member frontmatter (target is implicit). Move cross-cutting triggers into skill.yaml.`,
			});
		}
	});
	return errors;
}

function collectMemberRefs(
	commands: LoadedMember<SkillCommandMember>[],
	subagent: SkillSubagentMember | undefined,
	tools: LoadedMember<SkillToolMember>[],
): Set<string> {
	const refs = new Set<string>();
	for (const c of commands) refs.add(`command:${c.member.command.name}`);
	if (subagent) refs.add(`agent:${subagent.subagent.name}`);
	for (const t of tools) refs.add(`tool:${t.member.tool.name}`);
	return refs;
}

function mergeSubscriptions(
	manifestSubscribe: SkillTrigger[] | undefined,
	commands: LoadedMember<SkillCommandMember>[],
	subagent: LoadedMember<SkillSubagentMember> | undefined,
	tools: LoadedMember<SkillToolMember>[],
	memberRefs: Set<string>,
): {subscriptions: SkillTrigger[]; errors: string[]} {
	const subscriptions: SkillTrigger[] = [];
	const errors: string[] = [];
	const seen = new Set<string>();

	const push = (
		trig: SkillTrigger,
		resolvedTarget: string,
		origin: string,
	): void => {
		const key = `${trig.kind}|${resolvedTarget}`;
		if (seen.has(key)) {
			errors.push(
				`Duplicate subscription (kind=${trig.kind}, target=${resolvedTarget}) - declared in both manifest and ${origin}.`,
			);
			return;
		}
		seen.add(key);
		subscriptions.push({...trig, target: resolvedTarget});
	};

	if (manifestSubscribe) {
		manifestSubscribe.forEach((trig, i) => {
			const target = trig.target;
			if (!target || !TARGET_REGEX.test(target)) {
				errors.push(`subscribe[${i}].target "${target ?? ''}" is malformed.`);
				return;
			}
			if (!memberRefs.has(target)) {
				errors.push(
					`subscribe[${i}].target "${target}" does not resolve to a member of this bundle.`,
				);
				return;
			}
			push(trig, target, 'manifest');
		});
	}

	for (const c of commands) {
		if (!c.frontmatterSubscribe) continue;
		const ref = `command:${c.member.command.name}`;
		for (const trig of c.frontmatterSubscribe) {
			push(trig, ref, `${ref} frontmatter`);
		}
	}
	if (subagent?.frontmatterSubscribe) {
		const ref = `agent:${subagent.member.subagent.name}`;
		for (const trig of subagent.frontmatterSubscribe) {
			push(trig, ref, `${ref} frontmatter`);
		}
	}
	for (const t of tools) {
		if (!t.frontmatterSubscribe) continue;
		const ref = `tool:${t.member.tool.name}`;
		for (const trig of t.frontmatterSubscribe) {
			push(trig, ref, `${ref} frontmatter`);
		}
	}

	return {subscriptions, errors};
}

function errorMessage(err: unknown): string {
	return formatError(err);
}
