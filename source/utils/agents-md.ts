import {existsSync, readFileSync, statSync} from 'node:fs';
import {dirname, isAbsolute, join, resolve, sep} from 'node:path';
import {getConfigPath} from '@/config/paths';
import {MAX_AGENTS_MD_FILE_CHARS} from '@/constants';
import {
	getProjectRoot,
	getSafeSessionCwd,
	getSessionCwdScope,
} from '@/services/session-cwd';
import {isPathInside} from '@/utils/path-validation';

const AGENTS_MD_FILENAME = 'AGENTS.md';
// Marks a block already present in a prompt. Repeated appends (the TUI adds
// nested files before every model call in a turn) must not duplicate content.
const AGENTS_MD_MARKER_PREFIX = '<!-- AGENTS.md: ';
const AGENTS_MD_HEADER = 'Additional Context...';

/**
 * Tools whose `path`/`destination` arguments mean the agent is working under
 * that directory. `execute_bash` is deliberately absent: a shell command can
 * touch anything, and guessing from its command line would add rules for
 * directories the agent never actually opened.
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

// Fallback for the TUI and plain shell, which run without a session cwd scope.
const processAgentsMdPaths = new Set<string>();

interface AgentsMdFile {
	path: string;
	content: string;
}

export interface AppendAgentsMdOptions {
	/**
	 * Include AGENTS.md files discovered in project subdirectories. The base
	 * prompt only carries the user-level and project-root files so it stays
	 * cacheable; request-time callers opt into the nested layer.
	 */
	includeNested?: boolean;
}

function getDiscoveredPaths(): Set<string> {
	return getSessionCwdScope()?.agentsMdPaths ?? processAgentsMdPaths;
}

/** Forget every nested AGENTS.md discovered in this session (tests, /clear). */
export function resetAgentsMdTracker(): void {
	getDiscoveredPaths().clear();
}

/** Absolute paths of nested AGENTS.md files discovered so far. */
export function getDiscoveredAgentsMdPaths(): string[] {
	return [...getDiscoveredPaths()];
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
 * conflicts. Duplicate paths (NANOCODER_CONFIG_DIR inside the project) collapse
 * to their first occurrence.
 */
function getAgentsMdPaths(includeNested: boolean): string[] {
	const root = resolve(getProjectRoot());
	const rootAgentsPath = join(root, AGENTS_MD_FILENAME);
	const candidates = [
		join(getConfigPath(), AGENTS_MD_FILENAME),
		rootAgentsPath,
	];

	if (includeNested) {
		const nested = getDiscoveredAgentsMdPaths()
			.filter(filePath => isPathInside(filePath, root))
			.sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b));
		candidates.push(...nested);
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

/**
 * Append the layered AGENTS.md context to a system prompt. Idempotent: a file
 * whose marker is already in the prompt is skipped, so a caller can safely call
 * this before every request in a turn to pick up newly discovered files.
 */
export function appendAgentsMd(
	prompt: string,
	options: AppendAgentsMdOptions = {},
): string {
	const includeNested = options.includeNested ?? true;
	const blocks: string[] = [];

	for (const filePath of getAgentsMdPaths(includeNested)) {
		const file = readAgentsMdFile(filePath);
		if (!file) continue;

		const marker = `${AGENTS_MD_MARKER_PREFIX}${file.path} -->`;
		if (prompt.includes(marker)) continue;
		blocks.push(`${marker}\n${file.content}`);
	}

	if (blocks.length === 0) {
		return prompt;
	}

	const body = blocks.join('\n\n');
	if (prompt.includes(AGENTS_MD_MARKER_PREFIX)) {
		return `${prompt}\n\n${body}`;
	}

	return `${prompt}\n\n${AGENTS_MD_HEADER}\n\n${body}`;
}

/**
 * Record the AGENTS.md files that govern `targetPath` once the agent touches
 * it. Every ancestor from the file's directory up to (but not including) the
 * project root is collected, because a monorepo may put rules at several
 * levels. Paths outside the project are ignored.
 */
export function noteAgentsMdAccess(targetPath: string): void {
	const root = resolve(getProjectRoot());
	const absolute = isAbsolute(targetPath)
		? resolve(targetPath)
		: resolve(getSafeSessionCwd(), targetPath);

	let start = dirname(absolute);
	try {
		if (statSync(absolute).isDirectory()) {
			start = absolute;
		}
	} catch {
		// The path may not exist yet (a write), in which case its parent is the
		// directory being worked in.
	}

	if (!isPathInside(start, root)) {
		return;
	}

	const discovered = getDiscoveredPaths();
	let directory = start;
	while (isPathInside(directory, root) && resolve(directory) !== root) {
		const candidate = join(directory, AGENTS_MD_FILENAME);
		if (existsSync(candidate)) {
			discovered.add(resolve(candidate));
		}

		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
}

/**
 * Record AGENTS.md for a tool call's path arguments. Called from
 * `processToolUse`, the single chokepoint every frontend (TUI, plain, ACP,
 * subagents) executes tools through.
 */
export function noteAgentsMdAccessForTool(
	toolName: string,
	args: Record<string, unknown>,
): void {
	if (!FILE_ACCESS_TOOL_NAMES.has(toolName)) {
		return;
	}

	for (const key of ['path', 'file_path', 'destination']) {
		const value = args[key];
		if (typeof value === 'string' && value.trim()) {
			noteAgentsMdAccess(value);
		}
	}
}
