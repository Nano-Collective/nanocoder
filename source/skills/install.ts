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
import {
	access,
	cp,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
} from 'node:fs/promises';
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

type CloneResult = {ok: true} | {ok: false; error: string};

const GIT_ENV = {...process.env, GIT_TERMINAL_PROMPT: '0'};

function gitCloneErrorMessage(
	err: unknown,
	repo: string,
	ref?: string,
): string {
	const stderr =
		typeof (err as {stderr?: unknown})?.stderr === 'string'
			? (err as {stderr: string}).stderr.trim()
			: '';
	return `git clone failed for ${repo}${ref ? ` (ref ${ref})` : ''}: ${stderr || formatError(err)}`;
}

/** Plain shallow clone of the default branch. */
async function simpleClone(
	repo: string,
	destDir: string,
): Promise<CloneResult> {
	try {
		// `--` keeps a repo argument that starts with a dash from being read as
		// a flag.
		await execFileAsync(
			'git',
			['clone', '--depth', '1', '--single-branch', '--', repo, destDir],
			{timeout: CLONE_TIMEOUT_MS, env: GIT_ENV},
		);
		return {ok: true};
	} catch (err) {
		return {ok: false, error: gitCloneErrorMessage(err, repo)};
	}
}

/**
 * Clone at a specific ref. `git clone --branch` only accepts a branch or tag
 * name and rejects a commit SHA outright, but pinning to a commit is the
 * safe way to install code you don't fully trust - so this tries the cheap
 * shallow-clone-by-name path first, then falls back to init + fetch +
 * checkout, which accepts any revision git understands.
 */
async function cloneAtRef(
	repo: string,
	ref: string,
	destDir: string,
): Promise<CloneResult> {
	try {
		await execFileAsync(
			'git',
			[
				'clone',
				'--depth',
				'1',
				'--single-branch',
				'--branch',
				ref,
				'--',
				repo,
				destDir,
			],
			{timeout: CLONE_TIMEOUT_MS, env: GIT_ENV},
		);
		return {ok: true};
	} catch {
		// Not a branch or tag - fall through to fetch+checkout, which also
		// accepts a commit SHA.
	}

	await rm(destDir, {recursive: true, force: true});
	try {
		await execFileAsync('git', ['init', '--quiet', '--', destDir], {
			timeout: CLONE_TIMEOUT_MS,
		});
		await execFileAsync('git', ['remote', 'add', 'origin', '--', repo], {
			cwd: destDir,
			timeout: CLONE_TIMEOUT_MS,
		});
		try {
			await execFileAsync('git', ['fetch', '--depth', '1', 'origin', ref], {
				cwd: destDir,
				timeout: CLONE_TIMEOUT_MS,
				env: GIT_ENV,
			});
		} catch {
			// Some servers refuse a shallow fetch of an arbitrary commit; a full
			// fetch is the last resort.
			await execFileAsync('git', ['fetch', 'origin', ref], {
				cwd: destDir,
				timeout: CLONE_TIMEOUT_MS,
				env: GIT_ENV,
			});
		}
		await execFileAsync('git', ['checkout', '--quiet', 'FETCH_HEAD'], {
			cwd: destDir,
			timeout: CLONE_TIMEOUT_MS,
		});
		return {ok: true};
	} catch (err) {
		return {ok: false, error: gitCloneErrorMessage(err, repo, ref)};
	}
}

/**
 * Shallow-clone into `destDir`. Terminal prompts are disabled so a private
 * or mistyped repo fails fast instead of hanging on a credential prompt.
 */
async function cloneRepo(
	spec: InstallSpec,
	destDir: string,
): Promise<CloneResult> {
	return spec.ref
		? cloneAtRef(spec.repo, spec.ref, destDir)
		: simpleClone(spec.repo, destDir);
}

/**
 * A local filesystem path that is not itself a git working tree - the "path
 * on disk" the docs promise, for a bundle someone is authoring before it's
 * ever committed. Anything that IS a local git repo still goes through
 * `cloneRepo`, so a local install gets the exact same `--ref` / shallow-clone
 * semantics as a remote one, and uncommitted/untracked files never leak in.
 */
async function resolvePlainLocalDir(repo: string): Promise<string | null> {
	let info: Awaited<ReturnType<typeof stat>>;
	try {
		info = await stat(repo);
	} catch {
		return null;
	}
	if (!info.isDirectory()) return null;
	if (await pathExists(join(repo, '.git'))) return null;
	return resolve(repo);
}

async function copyLocalDir(
	source: string,
	destDir: string,
): Promise<CloneResult> {
	try {
		await cp(source, destDir, {recursive: true});
		return {ok: true};
	} catch (err) {
		return {
			ok: false,
			error: `Could not copy "${source}": ${formatError(err)}`,
		};
	}
}

/** True when `child` is `parent` itself or sits under it. */
function isContained(parent: string, child: string): boolean {
	const rel = relative(resolve(parent), resolve(child));
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * `isContained` is lexical: it compares announced path strings, not where
 * they actually resolve on disk. A git mode-120000 entry (a symlink) checks
 * out as a bundle directory that lexically sits under the clone but whose
 * real location is wherever the link points - `--subdir`, an index entry's
 * `subdir`, or the auto-discovered root can all name one. `pathExists`
 * (`fs.access`) follows the link when probing for `skill.yaml`, so it never
 * notices. This resolves both sides with the real filesystem location before
 * anything reads from or copies the bundle.
 */
async function assertBundleRootContained(
	cloneDir: string,
	bundleRoot: string,
): Promise<{ok: true} | {ok: false; error: string}> {
	let realClone: string;
	let realRoot: string;
	try {
		realClone = await realpath(cloneDir);
	} catch (err) {
		return {
			ok: false,
			error: `Could not resolve the clone directory: ${formatError(err)}`,
		};
	}
	try {
		realRoot = await realpath(bundleRoot);
	} catch (err) {
		return {
			ok: false,
			error: `Could not resolve the bundle path: ${formatError(err)}`,
		};
	}
	if (!isContained(realClone, realRoot)) {
		return {
			ok: false,
			error:
				'Refusing to install: the bundle path resolves outside the cloned repository (a symlink in the repo points elsewhere on disk).',
		};
	}
	return {ok: true};
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
			// registry entry rather than dropping the tool from the prompt. The
			// fallback approval is worst-case ('never' - runs without asking),
			// not the registry's own default: a trust prompt that under-reports
			// risk is worse than one that over-reports it.
			tools.push({
				name: member.tool.name,
				approval: 'never',
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
	const plainLocalDir = await resolvePlainLocalDir(spec.repo);
	if (plainLocalDir && spec.ref) {
		return fail(
			`"${spec.repo}" is a local directory, not a git repository; --ref cannot be used with it.`,
		);
	}
	const fetched = plainLocalDir
		? await copyLocalDir(plainLocalDir, cloneDir)
		: await cloneRepo(spec, cloneDir);
	if (!fetched.ok) return fail(fetched.error);

	// Drop git metadata before anything walks or copies the tree: it is
	// never part of the bundle, and it is the one place a repo can hide
	// hooks.
	await rm(join(cloneDir, '.git'), {recursive: true, force: true});

	const root = await findBundleRoot(cloneDir, spec);
	if ('error' in root) return fail(root.error);

	// `findBundleRoot` and the checks above only ever compare announced path
	// strings. A symlinked bundle directory (or an intermediate symlinked path
	// segment) lexically sits under the clone while actually resolving
	// elsewhere on disk - this is the one point before anything reads from or
	// copies the bundle where that gets caught.
	const contained = await assertBundleRootContained(cloneDir, root.path);
	if (!contained.ok) return fail(contained.error);

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

	let report: SkillCheckReport;
	try {
		report = await checkSkillBundle(opts.projectRoot, manifestName, root.path);
	} catch (err) {
		// An unexpected throw here must not leak the temp clone or surface as an
		// unhandled rejection out of cli.tsx.
		return fail(`Could not validate "${manifestName}": ${formatError(err)}`);
	}
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
	try {
		const result = await applyPromotion(plan, {force: opts.force});
		const commit: CommitResult = {ok: result.ok};
		if (result.destExists) commit.destExists = true;
		if (result.error) commit.error = result.error;
		return commit;
	} catch (err) {
		// An unexpected throw must still clean up the temp clone rather than
		// leak it and surface as an unhandled rejection out of cli.tsx.
		return {ok: false, error: formatError(err)};
	} finally {
		await staged.cleanup();
	}
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
	'Usage: nanocoder skills add <name|owner/repo|git-url> [--ref <ref>] [--subdir <path>] [--global] [--force] [--yes] [--index <url>]';

function defaultConfirm(prompt: string): Promise<boolean> {
	process.stdout.write(`${prompt}\n\n`);
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
	const parsed = parseAddArgs(opts.args);
	if ('error' in parsed) return {exitCode: 1, output: parsed.error};
	const {target, values, switches} = parsed;
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
	// A script that forgets --yes in a non-interactive environment must not
	// look like a successful no-op: there is no default-confirm question to
	// fall back to (a custom `confirm` from a caller owns its own semantics),
	// so this is a failure, not a decline.
	if (!autoAccepted && !opts.confirm && !process.stdin.isTTY) {
		await staged.staged.cleanup();
		return {
			exitCode: 1,
			output: `${prompt}\n\nNot a terminal — re-run with --yes to accept this skill. Aborted; nothing was written.`,
		};
	}
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
const KNOWN_SWITCHES = new Set(['--global', '--force', '--yes']);

interface ParsedAddArgs {
	target?: string;
	values: Record<string, string | undefined>;
	switches: Set<string>;
}

/**
 * Split `skills add` arguments into the target, value flags, and switches.
 * This is a security-sensitive command (it decides whether code runs
 * unattended), so a malformed invocation is an error rather than a silent
 * best-effort guess: an unrecognised `--forse` must not be accepted as a
 * no-op, and `--ref --global` must not swallow `--global` as the ref's
 * value - a flag-shaped next token means the value was omitted, not that the
 * next flag is the value.
 */
function parseAddArgs(args: string[]): ParsedAddArgs | {error: string} {
	const values: Record<string, string | undefined> = {};
	const switches = new Set<string>();
	let target: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (VALUE_FLAGS.has(arg)) {
			const value = args[i + 1];
			if (value === undefined || value.startsWith('--')) {
				return {error: `${arg} requires a value.`};
			}
			values[arg] = value;
			i++;
		} else if (arg.startsWith('--')) {
			if (!KNOWN_SWITCHES.has(arg)) {
				return {error: `Unknown flag: ${arg}\n${SKILLS_CLI_USAGE}`};
			}
			switches.add(arg);
		} else if (target === undefined) {
			target = arg;
		} else {
			return {error: `Unexpected extra argument: ${arg}\n${SKILLS_CLI_USAGE}`};
		}
	}
	return target === undefined ? {values, switches} : {target, values, switches};
}
