/**
 * Project instruction file resolution.
 *
 * AGENTS.md always wins, but repositories that standardised on another tool
 * often keep their guidance in a different file. When AGENTS.md is missing we
 * fall back to a configurable ordered list of well-known filenames, so the
 * prompt builder, /status and /doctor all agree on what was loaded.
 *
 * Whether any of this is sent to the model stays controlled by
 * `tune.includeAgentsMd` (and the nano profile), as before.
 *
 * The instruction file comes from the repository, so it is untrusted input.
 * Every candidate is checked like an `@path` import in AGENTS.md: it must be a
 * regular file inside the project root after symlinks, it must not live under
 * `.git` or match the project's ignore rules, and its contents are capped at
 * the tool-output limit. A fallback is skipped rather than reported when it
 * fails a check, so a later candidate can still supply the guidance.
 */
import {readFileSync, realpathSync, statSync} from 'node:fs';
import {isAbsolute, relative, resolve, sep} from 'node:path';
import {getAppConfig} from '@/config/index';
import {MAX_TOOL_RESULT_CHARS} from '@/constants';
import {truncateToolResult} from '@/tools/runtime/truncate-tool-result';
import {isNanoProfile} from '@/tools/tool-profiles';
import {
	DEFAULT_INSTRUCTION_FILES,
	TUNE_DEFAULTS,
	type TuneConfig,
} from '@/types/config';
import {loadGitignore} from '@/utils/fs/gitignore-loader';
import {isPathInside} from '@/utils/fs/path-validation';

export {DEFAULT_INSTRUCTION_FILES};

export interface ProjectInstructionFile {
	/** Filename from the configured list, e.g. `CLAUDE.md`. */
	name: string;
	/** Absolute path to the file. */
	path: string;
}

export interface ProjectInstructionFileContent extends ProjectInstructionFile {
	content: string;
}

/**
 * Candidate filenames in precedence order. AGENTS.md is always first; an
 * explicit empty `instructionFiles` config disables the fallbacks entirely.
 * The list comes from the user-level config only — a cloned project must not
 * be able to redirect which of its files are read into the system prompt.
 */
export function getInstructionFileNames(): string[] {
	const configured = getAppConfig().instructionFiles;
	const fallbacks = configured ?? DEFAULT_INSTRUCTION_FILES;

	const names = ['AGENTS.md'];
	const seen = new Set(['agents.md']);
	for (const name of fallbacks) {
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		names.push(name);
	}
	return names;
}

/**
 * Whether project instructions reach the model. Shared with /status so the
 * panel does not claim a file is loaded when the nano profile or an explicit
 * `tune.includeAgentsMd: false` suppressed it.
 */
export function shouldIncludeProjectInstructions(
	tuneConfig: Partial<TuneConfig> | undefined,
	model?: string,
): boolean {
	const enabled = tuneConfig?.enabled ?? TUNE_DEFAULTS.enabled;
	const profile = tuneConfig?.toolProfile ?? TUNE_DEFAULTS.toolProfile;
	const nano = enabled && isNanoProfile(profile, model);
	return tuneConfig?.includeAgentsMd ?? !nano;
}

/**
 * Resolve and read the first eligible project instruction file. This is the
 * single check behind both this function and {@link findProjectInstructionFile},
 * so /status and /doctor can never name a file the prompt builder skipped.
 */
export function loadProjectInstructionFile(
	projectRoot: string,
): ProjectInstructionFileContent | null {
	const root = resolve(projectRoot);
	let ignore: ReturnType<typeof loadGitignore> | undefined;

	for (const name of getInstructionFileNames()) {
		const path = eligiblePath(name, root);
		if (path === null) continue;

		const realRoot = safeRealPath(root);
		const realPath = safeRealPath(path);
		if (realRoot === null || realPath === null) continue;

		ignore ??= loadGitignore(root);
		const relativePath = relative(realRoot, realPath);
		if (
			!relativePath ||
			relativePath.startsWith('..') ||
			isAbsolute(relativePath)
		) {
			continue;
		}
		try {
			if (ignore.ignores(toPosix(relativePath))) continue;
		} catch {
			// Fail closed: an unparsable path must not bypass the ignore rules.
			continue;
		}

		try {
			const raw = readFileSync(path, 'utf-8');
			return {
				name,
				path,
				content: truncateToolResult(raw, MAX_TOOL_RESULT_CHARS),
			};
		} catch {
			// Try the next fallback instead of failing the whole system prompt.
		}
	}

	return null;
}

/**
 * Resolve the project instruction file without exposing its contents. Used by
 * the status panel and /doctor, which only need to name the file.
 */
export function findProjectInstructionFile(
	projectRoot: string,
): ProjectInstructionFile | null {
	const file = loadProjectInstructionFile(projectRoot);
	return file === null ? null : {name: file.name, path: file.path};
}

/**
 * A candidate is a relative, in-root path to a regular file. The realpath
 * check rejects symlinks that escape the project (a committed `CLAUDE.md` can
 * point at `~/.ssh/id_rsa`); the `.git` and ignore checks keep tokens and
 * `.env` files out of the system prompt.
 */
function eligiblePath(name: string, root: string): string | null {
	if (!name || name.includes('\0')) return null;
	if (isAbsolute(name) || /^[A-Za-z]:[/\\]/.test(name)) return null;

	const segments = name.split(/[\\/]/);
	if (
		segments.some(
			segment => segment === '..' || segment.toLowerCase() === '.git',
		)
	) {
		return null;
	}

	const path = resolve(root, name);
	const realPath = safeRealPath(path);
	const realRoot = safeRealPath(root);
	if (realPath === null || realRoot === null) return null;
	if (!isPathInside(path, root) || !isPathInside(realPath, realRoot)) {
		return null;
	}
	if (hasGitSegment(path) || hasGitSegment(realPath)) return null;

	try {
		return statSync(path).isFile() ? path : null;
	} catch {
		return null;
	}
}

/** `.git` at any depth, in either case, on the lexical or the real path. */
function hasGitSegment(path: string): boolean {
	return resolve(path)
		.split(/[\\/]/)
		.some(segment => segment.toLowerCase() === '.git');
}

function safeRealPath(path: string): string | null {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}

function toPosix(path: string): string {
	return sep === '/' ? path : path.split(sep).join('/');
}
