/**
 * Install a bundle-form skill from a git repository.
 *
 * `docs/features/skills.md` calls a bundle "one shareable artifact", but
 * until now the only way to share one was to copy files by hand. This is
 * the fetch half: `nanocoder skills add <name|owner/repo|git-url>`.
 *
 * Installing a skill is arbitrary code execution - a bundle tool is a shell
 * script, `approval: never` skips confirmation entirely, and a `subscribe:`
 * block makes the daemon fire it headless. So the flow never writes into the
 * project before the user has seen what they are agreeing to:
 *
 *   1. shallow-clone into a temp dir (git is already a hard dependency, so
 *      no tarball library is needed) and strip `.git`
 *   2. reject any symlink in the tree - a bundle is markdown and YAML, so a
 *      symlink is only ever an escape attempt
 *   3. validate through `parseSkillManifest` + the `/skills check` linter
 *   4. render a trust prompt listing every tool WITH its approval policy and
 *      every event subscription
 *   5. land it through `applyPromotion`, so collision and `--force` behave
 *      exactly like `/skills promote`
 *
 * Name resolution goes through a plain `skills.json` index hosted in a git
 * repo - no registry service. Override it with `NANOCODER_SKILLS_INDEX`
 * (an https URL or a local file path).
 */

import {execFile} from 'node:child_process';
import type {Dirent} from 'node:fs';
import {access, mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {promisify} from 'node:util';
import {getConfigPath} from '@/config/paths';
import {parseCustomToolFile} from '@/custom-tools/parser';
import {
	checkSkillBundle,
	formatSkillCheckReport,
	type SkillCheckReport,
} from '@/skills/check';
import {
	parseSkillManifest,
	SkillManifestParseError,
} from '@/skills/manifest-parser';
import {
	applyPromotion,
	type PromotionPlan,
	type SkillLevel,
} from '@/skills/promote';
import type {CustomToolApprovalPolicy} from '@/types/custom-tools';
import type {Skill, SkillToolVisibility} from '@/types/skills';
import {formatError} from '@/utils/error-formatter';

const execFileAsync = promisify(execFile);

const DEFAULT_INDEX_URL =
	'https://raw.githubusercontent.com/Nano-Collective/nanocoder-skills/main/skills.json';

/** A skill name as the manifest parser accepts it. */
const SKILL_NAME_REGEX = /^[a-z][a-z0-9-]*$/;
/** `owner/repo` GitHub shorthand. */
const GITHUB_SHORTHAND_REGEX = /^[\w.-]+\/[\w.-]+$/;

const CLONE_TIMEOUT_MS = 60_000;

/** One entry in the `skills.json` index. */
export interface SkillIndexEntry {
	name: string;
	description?: string;
	repo: string;
	ref?: string;
	subdir?: string;
}

/** Where a bundle is fetched from, after target resolution. */
export interface InstallSpec {
	repo: string;
	ref?: string;
	subdir?: string;
	/**
	 * Set when the spec came out of the index. The cloned manifest's `name`
	 * must match it, so an index entry cannot hand back a different skill
	 * than the one the user asked for.
	 */
	expectName?: string;
}

export interface SkillTrustTool {
	name: string;
	approval: CustomToolApprovalPolicy;
	readOnly: boolean;
}

/**
 * Everything the user has to agree to. Tool names alone don't say what a
 * bundle can do, so each tool carries its declared approval policy and each
 * subscription is rendered with the trigger that fires it.
 */
export interface SkillTrustSummary {
	name: string;
	description: string;
	version?: string;
	author?: string;
	toolsVisibility: SkillToolVisibility;
	commands: string[];
	agent?: string;
	tools: SkillTrustTool[];
	subscriptions: string[];
}

export interface StagedInstall {
	spec: InstallSpec;
	/** Validated bundle inside the temp clone. Nothing is copied yet. */
	bundlePath: string;
	report: SkillCheckReport;
	trust: SkillTrustSummary;
	dest: string;
	toLevel: SkillLevel;
	/** Remove the temp clone. Safe to call more than once. */
	cleanup: () => Promise<void>;
}

export interface StageOptions {
	projectRoot: string;
	/** Install into the platform config dir instead of the project. */
	global?: boolean;
	/** Overrides `NANOCODER_SKILLS_INDEX` and the default index URL. */
	indexUrl?: string;
	ref?: string;
	subdir?: string;
}

export type StageResult =
	| {ok: true; staged: StagedInstall}
	| {ok: false; error: string};

/**
 * Turn a user-supplied target into a fetch spec. Anything that names a
 * location (URL, scp-style git address, explicit local path, `owner/repo`)
 * is used directly; a bare skill name goes through the index.
 */
export function parseInstallTarget(target: string): InstallSpec | null {
	const value = target.trim();
	if (!value) return null;

	if (
		value.includes('://') ||
		value.startsWith('git@') ||
		value.startsWith('./') ||
		value.startsWith('../') ||
		value.startsWith('.\\') ||
		value.startsWith('..\\') ||
		isAbsolute(value)
	) {
		return {repo: value};
	}

	// `owner/repo` is unambiguous: a bare index name can never contain a
	// slash (skill names are kebab-case).
	if (GITHUB_SHORTHAND_REGEX.test(value)) {
		return {repo: `https://github.com/${value}.git`};
	}

	return null;
}

function indexUrl(explicit?: string): string {
	return explicit ?? process.env.NANOCODER_SKILLS_INDEX ?? DEFAULT_INDEX_URL;
}

/**
 * Read the index. A local path (or `file:` URL) is read from disk so a team
 * can point `NANOCODER_SKILLS_INDEX` at a checked-in file; everything else
 * is fetched over https.
 */
export async function fetchSkillIndex(
	explicitUrl?: string,
): Promise<SkillIndexEntry[]> {
	const url = indexUrl(explicitUrl);
	let raw: string;
	if (url.startsWith('file:')) {
		raw = await readFile(new URL(url), 'utf-8');
	} else if (!url.includes('://')) {
		raw = await readFile(url, 'utf-8');
	} else {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`${response.status} ${response.statusText}`);
		}
		raw = await response.text();
	}

	// Editors and some servers prefix UTF-8 with a BOM, which JSON.parse
	// rejects.
	const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
	const entries = Array.isArray(parsed)
		? parsed
		: ((parsed as {skills?: unknown})?.skills ?? null);
	if (!Array.isArray(entries)) {
		throw new Error(
			'index must be an array, or an object with a "skills" array',
		);
	}

	return entries.filter((entry): entry is SkillIndexEntry => {
		if (typeof entry !== 'object' || entry === null) return false;
		const {name, repo} = entry as Record<string, unknown>;
		return typeof name === 'string' && typeof repo === 'string';
	});
}

async function resolveFromIndex(
	name: string,
	explicitUrl?: string,
): Promise<{spec: InstallSpec} | {error: string}> {
	if (!SKILL_NAME_REGEX.test(name)) {
		return {
			error: `"${name}" is neither a skill name (kebab-case, e.g. pr-reviewer) nor a repository (owner/repo, https://…, git@…, or a local path).`,
		};
	}

	let entries: SkillIndexEntry[];
	try {
		entries = await fetchSkillIndex(explicitUrl);
	} catch (err) {
		return {
			error: `Could not read the skill index at ${indexUrl(explicitUrl)}: ${formatError(err)}\nPass a repository directly instead, e.g. "nanocoder skills add owner/repo".`,
		};
	}

	const entry = entries.find(e => e.name === name);
	if (!entry) {
		return {
			error: `No skill named "${name}" in the index at ${indexUrl(explicitUrl)}.`,
		};
	}
	const spec: InstallSpec = {repo: entry.repo, expectName: name};
	if (entry.ref) spec.ref = entry.ref;
	if (entry.subdir) spec.subdir = entry.subdir;
	return {spec};
}

/**
 * Shallow-clone into `destDir`. Terminal prompts are disabled so a private
 * or mistyped repo fails fast instead of hanging on a credential prompt.
 */
async function cloneRepo(
	spec: InstallSpec,
	destDir: string,
): Promise<{ok: true} | {ok: false; error: string}> {
	const args = ['clone', '--depth', '1', '--single-branch'];
	if (spec.ref) args.push('--branch', spec.ref);
	// `--` keeps a repo argument that starts with a dash from being read as
	// a flag.
	args.push('--', spec.repo, destDir);

	try {
		await execFileAsync('git', args, {
			timeout: CLONE_TIMEOUT_MS,
			env: {...process.env, GIT_TERMINAL_PROMPT: '0'},
		});
		return {ok: true};
	} catch (err) {
		const stderr =
			typeof (err as {stderr?: unknown})?.stderr === 'string'
				? (err as {stderr: string}).stderr.trim()
				: '';
		return {
			ok: false,
			error: `git clone failed for ${spec.repo}${spec.ref ? ` (ref ${spec.ref})` : ''}: ${stderr || formatError(err)}`,
		};
	}
}

/** True when `child` is `parent` itself or sits under it. */
function isContained(parent: string, child: string): boolean {
	const rel = relative(resolve(parent), resolve(child));
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Locate the bundle inside a clone. An explicit `--subdir` is taken at its
 * word (and must stay inside the clone); otherwise the manifest is looked
 * for at the repo root, then at the name the index promised, then across the
 * one-directory-per-bundle layouts. Several candidates is an error rather
 * than a guess - the user has to say which skill they meant.
 */
async function findBundleRoot(
	cloneDir: string,
	spec: InstallSpec,
): Promise<{path: string} | {error: string}> {
	if (spec.subdir) {
		const candidate = join(cloneDir, spec.subdir);
		if (!isContained(cloneDir, candidate)) {
			return {error: `subdir "${spec.subdir}" escapes the cloned repository.`};
		}
		if (await pathExists(join(candidate, 'skill.yaml'))) {
			return {path: candidate};
		}
		return {error: `No skill.yaml at subdir "${spec.subdir}".`};
	}

	if (await pathExists(join(cloneDir, 'skill.yaml'))) return {path: cloneDir};

	if (spec.expectName) {
		for (const rel of [join('skills', spec.expectName), spec.expectName]) {
			if (await pathExists(join(cloneDir, rel, 'skill.yaml'))) {
				return {path: join(cloneDir, rel)};
			}
		}
	}

	const found = await collectBundleDirs(cloneDir);
	if (found.length === 1) return {path: join(cloneDir, found[0])};
	if (found.length > 1) {
		return {
			error: `The repository holds ${found.length} skill bundles (${found.join(', ')}). Pick one with --subdir <path>.`,
		};
	}
	return {
		error:
			'No skill.yaml found. Point --subdir at the directory holding the bundle manifest.',
	};
}

/**
 * Clone-relative paths of every directory holding a `skill.yaml`, looking one
 * level down from the root and one level under `skills/` - the two layouts a
 * multi-skill repo uses.
 */
async function collectBundleDirs(cloneDir: string): Promise<string[]> {
	const found: string[] = [];
	for (const base of ['', 'skills']) {
		let entries: Dirent[];
		try {
			entries = await readdir(join(cloneDir, base), {withFileTypes: true});
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const rel = base ? join(base, entry.name) : entry.name;
			if (await pathExists(join(cloneDir, rel, 'skill.yaml'))) found.push(rel);
		}
	}
	return found;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Walk the bundle and reject anything a markdown-and-YAML bundle has no
 * business containing. Symlinks are the whole point: git will happily
 * check one out pointing at `~/.ssh/id_rsa`, and the copy that lands the
 * bundle would follow it.
 */
async function scanBundleTree(
	bundlePath: string,
): Promise<{ok: true} | {ok: false; error: string}> {
	const stack = [bundlePath];
	while (stack.length > 0) {
		const dir = stack.pop() as string;
		let entries: Dirent[];
		try {
			entries = await readdir(dir, {withFileTypes: true});
		} catch (err) {
			return {ok: false, error: `Could not read ${dir}: ${formatError(err)}`};
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isSymbolicLink()) {
				const rel = relative(bundlePath, full) || entry.name;
				return {
					ok: false,
					error: `Refusing to install: the bundle contains a symlink (${rel}). Skill bundles are plain files.`,
				};
			}
			if (entry.isDirectory()) stack.push(full);
		}
	}
	return {ok: true};
}

function describeSubscription(
	trigger: NonNullable<Skill['subscribe']>[number],
): string {
	const target = trigger.target ?? '(self)';
	const detail =
		trigger.kind === 'schedule.cron'
			? `cron "${trigger.cron}"`
			: `paths ${(trigger.paths ?? ['**']).join(', ')}`;
	return `${trigger.kind} → ${target} · ${detail}${trigger.confirm ? ' [confirm: plan mode]' : ''}`;
}

/**
 * Build the trust summary from an already-validated bundle. Tool approval
 * policy is read back off the member file: the built `ToolEntry` collapses
 * `destructive` into a predicate, and the user needs the declared word.
 */
export function buildTrustSummary(skill: Skill): SkillTrustSummary {
	const tools: SkillTrustTool[] = [];
	for (const member of skill.tools ?? []) {
		try {
			const {metadata} = parseCustomToolFile(member.filePath);
			tools.push({
				name: metadata.name,
				approval: metadata.approval,
				readOnly: metadata.readOnly,
			});
		} catch {
			// Unreachable for a bundle that passed the linter; fall back to the
			// registry entry rather than dropping the tool from the prompt.
			tools.push({
				name: member.tool.name,
				approval: 'always',
				readOnly: member.tool.readOnly === true,
			});
		}
	}

	const summary: SkillTrustSummary = {
		name: skill.name,
		description: skill.description,
		toolsVisibility: skill.toolsVisibility,
		commands: (skill.commands ?? []).map(c => `/${c.command.fullName}`),
		tools,
		subscriptions: (skill.subscribe ?? []).map(describeSubscription),
	};
	if (skill.version) summary.version = skill.version;
	if (skill.author) summary.author = skill.author;
	if (skill.subagent) summary.agent = skill.subagent.subagent.name;
	return summary;
}

const APPROVAL_NOTE: Record<CustomToolApprovalPolicy, string> = {
	never: 'runs WITHOUT asking',
	always: 'asks every time',
	destructive: 'asks for destructive writes',
};

/** Plain-text trust prompt. Rendered before anything touches the project. */
export function formatTrustSummary(
	trust: SkillTrustSummary,
	dest: string,
	origin: string,
): string {
	const lines: string[] = [
		`Skill "${trust.name}"${trust.version ? ` v${trust.version}` : ''}${trust.author ? ` by ${trust.author}` : ''}`,
		`  ${trust.description}`,
		'',
		`  from: ${origin}`,
		`  into: ${dest}`,
		'',
	];

	if (trust.commands.length > 0) {
		lines.push(`  Commands: ${trust.commands.join(', ')}`);
	}
	if (trust.agent) lines.push(`  Agent:    ${trust.agent}`);

	if (trust.tools.length > 0) {
		lines.push(
			`  Tools (${trust.toolsVisibility === 'scoped' ? 'visible only to this skill’s agent' : 'visible to every agent'}):`,
		);
		for (const tool of trust.tools) {
			lines.push(
				`    - ${tool.name} · shell script · approval: ${tool.approval} (${APPROVAL_NOTE[tool.approval]})${tool.readOnly ? ' · read-only' : ''}`,
			);
		}
	}

	if (trust.subscriptions.length > 0) {
		lines.push('  Event subscriptions (the daemon fires these unattended):');
		for (const sub of trust.subscriptions) lines.push(`    - ${sub}`);
	}

	if (trust.tools.length === 0 && trust.subscriptions.length === 0) {
		lines.push('  No tools and no event subscriptions.');
	}

	lines.push(
		'',
		'Installing a skill means running its code. Only install skills you trust.',
	);
	return lines.join('\n');
}

/**
 * Fetch, validate, and describe a skill without writing anything into the
 * project. The caller shows `staged.trust` to the user, then either calls
 * `commitSkillInstall` or `staged.cleanup()`.
 */
export async function stageSkillInstall(
	target: string,
	opts: StageOptions,
): Promise<StageResult> {
	const direct = parseInstallTarget(target);
	let spec: InstallSpec;
	if (direct) {
		spec = direct;
	} else {
		const resolved = await resolveFromIndex(target, opts.indexUrl);
		if ('error' in resolved) return {ok: false, error: resolved.error};
		spec = resolved.spec;
	}
	if (opts.ref) spec.ref = opts.ref;
	if (opts.subdir) spec.subdir = opts.subdir;

	const tempRoot = await mkdtemp(join(tmpdir(), 'nanocoder-skill-'));
	const cleanup = async () => {
		await rm(tempRoot, {recursive: true, force: true});
	};
	const fail = async (error: string): Promise<StageResult> => {
		await cleanup();
		return {ok: false, error};
	};

	const cloneDir = join(tempRoot, 'clone');
	const cloned = await cloneRepo(spec, cloneDir);
	if (!cloned.ok) return fail(cloned.error);

	// Drop git metadata before anything walks or copies the tree: it is
	// never part of the bundle, and it is the one place a repo can hide
	// hooks.
	await rm(join(cloneDir, '.git'), {recursive: true, force: true});

	const root = await findBundleRoot(cloneDir, spec);
	if ('error' in root) return fail(root.error);

	const scanned = await scanBundleTree(root.path);
	if (!scanned.ok) return fail(scanned.error);

	let manifestName: string;
	try {
		manifestName = parseSkillManifest(join(root.path, 'skill.yaml')).name;
	} catch (err) {
		const message =
			err instanceof SkillManifestParseError ? err.message : formatError(err);
		return fail(`Invalid skill.yaml: ${message}`);
	}

	// The index said one thing; the repo delivered another. Refuse rather
	// than silently installing a skill under a name the user never asked for.
	if (spec.expectName && spec.expectName !== manifestName) {
		return fail(
			`The index lists "${spec.expectName}" but the bundle declares "${manifestName}". Refusing to install.`,
		);
	}

	const report = await checkSkillBundle(
		opts.projectRoot,
		manifestName,
		root.path,
	);
	if (!report.ok || !report.skill) {
		return fail(
			`Skill "${manifestName}" failed validation:\n${formatSkillCheckReport(report)}`,
		);
	}

	const toLevel: SkillLevel = opts.global ? 'global' : 'project';
	const base = opts.global
		? getConfigPath()
		: join(opts.projectRoot, '.nanocoder');

	return {
		ok: true,
		staged: {
			spec,
			bundlePath: root.path,
			report,
			trust: buildTrustSummary(report.skill),
			dest: join(base, 'skills', manifestName),
			toLevel,
			cleanup,
		},
	};
}

interface CommitResult {
	ok: boolean;
	/** Destination already exists and `force` was not set. */
	destExists?: boolean;
	error?: string;
}

/** Land a staged bundle, then remove the temp clone either way. */
async function commitSkillInstall(
	staged: StagedInstall,
	opts: {force?: boolean} = {},
): Promise<CommitResult> {
	const plan: PromotionPlan = {
		skillName: staged.trust.name,
		shape: 'bundle',
		fromLevel: 'remote',
		toLevel: staged.toLevel,
		source: staged.bundlePath,
		dest: staged.dest,
	};
	const result = await applyPromotion(plan, {force: opts.force});
	await staged.cleanup();
	const commit: CommitResult = {ok: result.ok};
	if (result.destExists) commit.destExists = true;
	if (result.error) commit.error = result.error;
	return commit;
}

// ---------------------------------------------------------------------------
// CLI surface: `nanocoder skills add …`
// ---------------------------------------------------------------------------

export interface SkillsCliResult {
	exitCode: 0 | 1;
	output: string;
}

export interface SkillsCliOptions {
	projectRoot: string;
	/** Arguments after `skills add`. */
	args: string[];
	/**
	 * Show the trust prompt and ask. Defaults to a stdin question; tests and
	 * `--yes` replace it.
	 */
	confirm?: (prompt: string) => Promise<boolean>;
}

export const SKILLS_CLI_USAGE =
	'Usage: nanocoder skills add <name|owner/repo|git-url> [--ref <ref>] [--subdir <path>] [--global] [--force] [--yes]';

function defaultConfirm(prompt: string): Promise<boolean> {
	process.stdout.write(`${prompt}\n\n`);
	if (!process.stdin.isTTY) {
		process.stdout.write(
			'Not a terminal — re-run with --yes to accept this skill.\n',
		);
		return Promise.resolve(false);
	}
	const rl = createInterface({input: process.stdin, output: process.stdout});
	return new Promise(resolvePrompt => {
		rl.question('Install this skill? [y/N] ', answer => {
			rl.close();
			resolvePrompt(/^y(es)?$/i.test(answer.trim()));
		});
	});
}

/**
 * `nanocoder skills add`. Returns `{exitCode, output}` so `cli.tsx` fans the
 * result to the right stream, exactly like the daemon CLI.
 */
export async function runSkillsCli(
	opts: SkillsCliOptions,
): Promise<SkillsCliResult> {
	const {target, values, switches} = parseAddArgs(opts.args);
	if (!target) return {exitCode: 1, output: SKILLS_CLI_USAGE};

	const stageOptions: StageOptions = {projectRoot: opts.projectRoot};
	if (switches.has('--global')) stageOptions.global = true;
	if (values['--ref']) stageOptions.ref = values['--ref'];
	if (values['--subdir']) stageOptions.subdir = values['--subdir'];
	if (values['--index']) stageOptions.indexUrl = values['--index'];

	const staged = await stageSkillInstall(target, stageOptions);
	if (!staged.ok) return {exitCode: 1, output: staged.error};

	const origin = `${staged.staged.spec.repo}${staged.staged.spec.ref ? `#${staged.staged.spec.ref}` : ''}`;
	const prompt = formatTrustSummary(
		staged.staged.trust,
		staged.staged.dest,
		origin,
	);

	// `--yes` still reports what was accepted: an unattended install that
	// leaves no record of the tools and subscriptions it agreed to is exactly
	// the thing the prompt exists to prevent.
	const autoAccepted = switches.has('--yes');
	const accepted = autoAccepted
		? true
		: await (opts.confirm ?? defaultConfirm)(prompt);
	if (!accepted) {
		await staged.staged.cleanup();
		return {exitCode: 0, output: 'Aborted. Nothing was written.'};
	}
	const preamble = autoAccepted ? `${prompt}\n\n` : '';

	const result = await commitSkillInstall(staged.staged, {
		force: switches.has('--force'),
	});
	if (result.destExists) {
		return {
			exitCode: 1,
			output: `A skill already exists at ${staged.staged.dest}.\nRe-run with --force to replace it.`,
		};
	}
	if (!result.ok) {
		return {
			exitCode: 1,
			output: `Failed to install "${staged.staged.trust.name}": ${result.error ?? 'unknown error'}`,
		};
	}

	return {
		exitCode: 0,
		output: `${preamble}Installed "${staged.staged.trust.name}" into ${staged.staged.dest}.\nRestart nanocoder to load it, or run "/skills show ${staged.staged.trust.name}".`,
	};
}

const VALUE_FLAGS = new Set(['--ref', '--subdir', '--index']);

/** Split `skills add` arguments into the target, value flags, and switches. */
function parseAddArgs(args: string[]): {
	target?: string;
	values: Record<string, string | undefined>;
	switches: Set<string>;
} {
	const values: Record<string, string | undefined> = {};
	const switches = new Set<string>();
	let target: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (VALUE_FLAGS.has(arg)) {
			values[arg] = args[++i];
		} else if (arg.startsWith('--')) {
			switches.add(arg);
		} else if (target === undefined) {
			target = arg;
		}
	}
	return target === undefined ? {values, switches} : {target, values, switches};
}
