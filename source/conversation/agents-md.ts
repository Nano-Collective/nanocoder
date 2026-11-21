/**
 * Layered AGENTS.md rules.
 *
 * Three layers are supported:
 *
 * 1. `<config dir>/AGENTS.md` — follows the user across projects, including
 *    an explicit `NANOCODER_CONFIG_DIR`.
 * 2. `<project root>/AGENTS.md` — the existing project-level rules.
 * 3. Nested files under the project root, discovered lazily once the agent
 *    reads or edits a file in a subdirectory. They are ordered shallow to deep
 *    so the closest file comes last.
 *
 * Layers 1 and 2 are baked into the base system prompt by `prompt-builder`.
 * Layer 3 changes as the agent works, so it travels in the user message at
 * request time (via `appendTurnContext`) to keep the system block byte-stable
 * for prompt caching. This module lives in `conversation/` rather than
 * `utils/` because it reads session-scoped state (`session-cwd`).
 */
import {existsSync, readFileSync, statSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {getConfigPath} from '@/config/paths';
import {MAX_AGENTS_MD_FILE_CHARS} from '@/constants';
import {defineSessionValue} from '@/services/session-context';
import {getProjectRoot, getSafeSessionCwd} from '@/services/session-cwd';
import {loadGitignore} from '@/utils/fs/gitignore-loader';
import {isPathInside} from '@/utils/fs/path-validation';

const AGENTS_MD_FILENAME = 'AGENTS.md';
// Marks an already-injected block. Re-appending the base layer (or rebuilding
// turn context on every request) must not duplicate a file.
const AGENTS_MD_MARKER_PREFIX = '<!-- AGENTS.md: ';
const AGENTS_MD_HEADER = 'Additional Context...';
const NESTED_HEADER = '## AGENTS.md in project subdirectories';

/**
 * Tools whose `path`/`destination` argument means the agent is working under
 * that directory. `execute_bash` is deliberately absent: parsing a shell
 * command would guess at directories the agent never actually opened.
 */
const FILE_ACCESS_TOOL_NAMES = new Set([
	'read_file',
	'write_file',
	'string_replace',
	'diff_edit',
	'file_op',
	'list_directory',
	'search_file_contents',
	'lsp_format_document',
	'lsp_get_diagnostics',
]);

/**
 * Nested files discovered so far, stored per session so concurrent ACP
 * sessions cannot see each other's rules. Outside a session (TUI, plain shell)
 * the value is process-wide, which is the one session of that process.
 */
const discoveredPaths = defineSessionValue<Set<string>>();

function getDiscoveredPaths(): Set<string> {
	let paths = discoveredPaths.get();
	if (!paths) {
		paths = new Set<string>();
		discoveredPaths.set(paths);
	}
	return paths;
}

/** Forget every nested AGENTS.md discovered in this session (tests, /clear). */
export function resetAgentsMdTracker(): void {
	discoveredPaths.set(new Set<string>());
}

/** Absolute paths of nested AGENTS.md files discovered so far. */
export function getDiscoveredAgentsMdPaths(): string[] {
	return [...getDiscoveredPaths()];
}

interface AgentsMdFile {
	path: string;
	content: string;
}

/**
 * Read one AGENTS.md, capped per file. The truncation note is part of the
 * content so the model can see that rules were omitted rather than silently
 * assuming it has the whole file.
 */
function readAgentsMdFile(filePath: string): AgentsMdFile | null {
	let content: string;
	try {
		content = readFileSync(filePath, 'utf-8');
	} catch {
		return null;
	}

	if (!content.trim()) {
		return null;
	}

	const originalLength = content.length;
	if (originalLength > MAX_AGENTS_MD_FILE_CHARS) {
		const omitted = originalLength - MAX_AGENTS_MD_FILE_CHARS;
		content = `${content.slice(
			0,
			MAX_AGENTS_MD_FILE_CHARS,
		)}\n\n[AGENTS.md truncated: ${omitted} of ${originalLength} characters omitted]`;
	}

	return {path: resolve(filePath), content};
}

function pathDepth(filePath: string): number {
	return resolve(filePath).split(sep).length;
}

// Windows paths are case-insensitive, so `C:\Repo` and `c:\repo` are the same
// file and must not be appended twice.
function pathKey(filePath: string): string {
	const absolute = resolve(filePath);
	return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

/**
 * Candidate files in precedence order: user-level first, then project root,
 * then nested files shallow-to-deep so the closest file comes last and wins on
 * conflicts. Duplicate paths (a config dir inside the project) collapse to
 * their first occurrence.
 */
function getAgentsMdPaths(includeNested: boolean): string[] {
	const root = resolve(getProjectRoot());
	const candidates = [
		join(getConfigPath(), AGENTS_MD_FILENAME),
		join(root, AGENTS_MD_FILENAME),
	];

	if (includeNested) {
		candidates.push(
			...getDiscoveredAgentsMdPaths()
				.filter(filePath => isPathInside(filePath, root))
				.sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b)),
		);
	}

	const seen = new Set<string>();
	const paths: string[] = [];
	for (const candidate of candidates) {
		const absolute = resolve(candidate);
		const key = pathKey(absolute);
		if (seen.has(key)) continue;
		seen.add(key);
		paths.push(absolute);
	}

	return paths;
}

function nestedAgentsMdPaths(): string[] {
	const root = resolve(getProjectRoot());
	const seen = new Set<string>();
	return getDiscoveredAgentsMdPaths()
		.filter(filePath => isPathInside(filePath, root))
		.sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b))
		.filter(filePath => {
			const key = pathKey(filePath);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

function agentsMdBlock(file: AgentsMdFile): string {
	return `${AGENTS_MD_MARKER_PREFIX}${file.path} -->\n${file.content}`;
}

/**
 * Append the stable layers of AGENTS.md to a system prompt. Idempotent: a file
 * whose marker is already present is skipped. Nested files are deliberately
 * excluded here — they are injected at request time, where they cannot break
 * the system-prompt cache prefix.
 */
export function appendAgentsMd(prompt: string): string {
	const blocks: string[] = [];
	for (const filePath of getAgentsMdPaths(false)) {
		const file = readAgentsMdFile(filePath);
		if (
			!file ||
			prompt.includes(`${AGENTS_MD_MARKER_PREFIX}${file.path} -->`)
		) {
			continue;
		}
		blocks.push(agentsMdBlock(file));
	}

	if (blocks.length === 0) return prompt;

	const body = blocks.join('\n\n');
	if (prompt.includes(AGENTS_MD_MARKER_PREFIX)) {
		return `${prompt}\n\n${body}`;
	}
	return `${prompt}\n\n${AGENTS_MD_HEADER}\n\n${body}`;
}

/**
 * The nested layer for the next model request, formatted as a turn-context
 * section. Returns undefined when nothing has been discovered, so callers can
 * leave the request byte-identical to the previous one.
 */
export function getNestedAgentsMdSection(): string | undefined {
	const blocks: string[] = [];
	for (const filePath of nestedAgentsMdPaths()) {
		const file = readAgentsMdFile(filePath);
		if (file) blocks.push(agentsMdBlock(file));
	}
	if (blocks.length === 0) return undefined;
	return `${NESTED_HEADER}\n\n${blocks.join('\n\n')}`;
}

type IgnoreMatcher = ReturnType<typeof loadGitignore>;

interface CachedIgnore {
	key: string;
	matcher: IgnoreMatcher;
}

// Discovery happens on every successful file tool call. Reloading .gitignore
// and .nanocoderignore each time would be wasteful, so cache per root and
// invalidate when either file changes.
const ignoreCache = new Map<string, CachedIgnore>();

/** Clear the per-root ignore cache (tests, config reload). */
export function resetAgentsMdIgnoreCache(): void {
	ignoreCache.clear();
}

function ignoreMtime(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}

function getIgnoreMatcher(root: string): IgnoreMatcher {
	const key = `${ignoreMtime(join(root, '.gitignore'))}|${ignoreMtime(
		join(root, '.nanocoderignore'),
	)}`;
	const cached = ignoreCache.get(root);
	if (cached?.key === key) return cached.matcher;

	const matcher = loadGitignore(root, {nanocoderIgnore: true});
	ignoreCache.set(root, {key, matcher});
	return matcher;
}

/** POSIX-style path relative to the project root, or null when outside it. */
function toProjectRelative(root: string, absolutePath: string): string | null {
	const rel = relative(root, absolutePath);
	if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
	return rel.split(sep).join('/');
}

/**
 * Record the AGENTS.md files that govern `targetPath` once the agent touches
 * it. Every ancestor from the file's directory up to (but not including) the
 * project root is collected, because a monorepo may keep rules at several
 * levels.
 *
 * Candidates are filtered through the same ignore matcher as the file-search
 * tools: an AGENTS.md under node_modules, a build directory, or a path hidden
 * by .gitignore/.nanocoderignore must not become instructions the model obeys.
 */
export function noteAgentsMdAccess(targetPath: string): void {
	const root = resolve(getProjectRoot());
	const absolute = isAbsolute(targetPath)
		? resolve(targetPath)
		: resolve(getSafeSessionCwd(), targetPath);

	let start = dirname(absolute);
	try {
		if (statSync(absolute).isDirectory()) start = absolute;
	} catch {
		// A path that does not exist yet (a write) is being created in its
		// parent directory, so that parent is the place to look.
	}

	if (!isPathInside(start, root)) return;

	const matcher = getIgnoreMatcher(root);
	const discovered = getDiscoveredPaths();
	let directory = start;
	while (isPathInside(directory, root) && resolve(directory) !== root) {
		const relativeDir = toProjectRelative(root, directory);
		const dirIgnored =
			relativeDir !== null && matcher.ignores(`${relativeDir}/`);
		if (!dirIgnored) {
			const candidate = join(directory, AGENTS_MD_FILENAME);
			const relativeCandidate = toProjectRelative(root, candidate);
			if (
				relativeCandidate &&
				!matcher.ignores(relativeCandidate) &&
				existsSync(candidate)
			) {
				discovered.add(resolve(candidate));
			}
		}

		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
}

/**
 * Record AGENTS.md for a tool call's path arguments. The TUI, plain shell and
 * ACP execute tools through `processToolUse`, which calls this. Subagents run
 * their own tool loop and call it directly after a successful tool.
 */
export function noteAgentsMdAccessForTool(
	toolName: string,
	args: Record<string, unknown>,
): void {
	if (!FILE_ACCESS_TOOL_NAMES.has(toolName)) return;

	for (const key of ['path', 'file_path', 'destination']) {
		const value = args[key];
		if (typeof value === 'string' && value.trim()) {
			noteAgentsMdAccess(value);
		}
	}
}
