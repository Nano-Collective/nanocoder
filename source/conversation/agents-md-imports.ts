import {readFileSync, realpathSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {MAX_TOOL_RESULT_CHARS} from '@/constants';
import {truncateToolResult} from '@/tools/runtime/truncate-tool-result';
import {isPathInside} from '@/utils/fs/path-validation';

/**
 * `@path` imports inside AGENTS.md.
 *
 * A 600 line AGENTS.md is sent on every request, and splitting it into topic
 * files is only useful if the main file can pull them in: the model would
 * otherwise receive the reference as literal text. A line that is exactly a
 * reference (`@docs/testing.md`, or `@~/docs/style.md` for user files) is
 * replaced by the file's contents, recursively, so the system prompt holds the
 * whole instruction set while the repository keeps reviewable pieces.
 *
 * The nesting is bounded on purpose. AGENTS.md comes from the repository, so a
 * clone is untrusted input that decides what gets read and sent:
 *
 * - every import must resolve inside the project root, checked again after
 *   resolving symlinks, so neither an in-repo link nor a `@~/...` reference
 *   can point the model at `~/.ssh` or at the config directory, which holds
 *   credentials;
 * - lines inside fenced code blocks are left alone, so an AGENTS.md that
 *   documents the syntax is not rewritten;
 * - a file already included is not read again (a cycle ends in a warning, not
 *   a hang), and nesting stops after a handful of levels;
 * - each file is capped like tool output and the whole expansion has its own
 *   budget, so one import cannot exhaust the context window.
 */

/** Nesting stops here; AGENTS.md itself is depth 0. */
const MAX_IMPORT_DEPTH = 5;

/** Total characters of imported content accepted in one expansion. */
const MAX_IMPORTED_CHARS = 100_000;

/** A whole line that is nothing but a reference, with no indentation. */
const IMPORT_LINE = /^@(\S+)\s*$/;

/** Fence opener: ``` or ~~~ (three or more, either character). */
const FENCE = /^\s*(`{3,}|~{3,})/;

/** Fence closer: only fence characters, optionally indented. */
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

export interface AgentsMdImportOptions {
	/** Absolute path of the AGENTS.md being expanded. */
	filePath: string;
	/** Project root; imports must stay inside it. */
	projectRoot: string;
	/** Home directory `~/` expands against. Injectable for tests. */
	homeDir?: string;
	/** Overrides for tests; both default to the module constants. */
	maxDepth?: number;
	maxChars?: number;
}

export interface AgentsMdImportResult {
	/** The AGENTS.md text with every resolved import inlined. */
	content: string;
	/** One user-facing line per import that could not be included. */
	warnings: string[];
}

interface AllowedRoot {
	lexical: string;
	real: string | null;
}

interface ExpandState {
	roots: AllowedRoot[];
	/** Used to name the offending file in a warning. */
	projectRoot: string;
	home: string;
	maxDepth: number;
	maxChars: number;
	/** Real paths already included (or the root), for cycle detection. */
	seen: Set<string>;
	importedChars: number;
	warnings: string[];
}

/**
 * Inline every `@path` line in `content`, recursively.
 *
 * Unresolved imports are reported in `warnings` and left in place, so the
 * model still sees the reference and the user finds out why it was not loaded.
 */
export function expandAgentsMdImports(
	content: string,
	options: AgentsMdImportOptions,
): AgentsMdImportResult {
	const state: ExpandState = {
		// The project root is the only allowed root on purpose. The user config
		// directory holds `agents.config.json` (provider keys) and
		// `codex-credentials.json`, and AGENTS.md comes from the repository, so
		// letting a clone reach that directory would put the user's credentials
		// in the system prompt.
		roots: toAllowedRoots([options.projectRoot]),
		projectRoot: resolve(options.projectRoot),
		home: options.homeDir ?? homedir(),
		maxDepth: options.maxDepth ?? MAX_IMPORT_DEPTH,
		maxChars: options.maxChars ?? MAX_IMPORTED_CHARS,
		seen: new Set(),
		importedChars: 0,
		warnings: [],
	};

	const root = safeRealPath(options.filePath);
	if (root) state.seen.add(root);

	return {
		content: expandContent(
			content,
			dirname(options.filePath),
			0,
			state,
			labelFor(options.filePath, state),
		),
		warnings: state.warnings,
	};
}

/** Walks the lines, leaving fenced code and plain prose untouched. */
function expandContent(
	content: string,
	baseDir: string,
	depth: number,
	state: ExpandState,
	sourceLabel: string,
): string {
	const lines = content.split(/\r?\n/);
	const output: string[] = [];
	// A closer must use the same character and be at least as long as the
	// opener, so a ``` line inside a ```` block does not end the block early.
	let fence: {character: string; length: number} | null = null;

	for (const line of lines) {
		const fenceMatch = line.match(FENCE);
		if (fenceMatch) {
			const run = fenceMatch[1] ?? '`';
			const character = run[0] ?? '`';
			if (fence === null) {
				fence = {character, length: run.length};
			} else {
				const closeRun = line.match(FENCE_CLOSE)?.[1] ?? '';
				if (
					closeRun.length >= fence.length &&
					(closeRun[0] ?? '') === fence.character
				) {
					fence = null;
				}
			}
			output.push(line);
			continue;
		}

		if (fence !== null) {
			output.push(line);
			continue;
		}

		const importMatch = line.match(IMPORT_LINE);
		const spec = importMatch?.[1] ?? '';
		// `@TODO` or `@decorator` on a line of its own is not a file reference;
		// warning about a file that was never meant is worse than silence.
		if (!importMatch || !looksLikePath(spec)) {
			output.push(line);
			continue;
		}

		output.push(expandImport(spec, baseDir, depth, line, state, sourceLabel));
	}

	return output.join('\n');
}

/** Resolve one reference, or explain why it stays as text. */
function expandImport(
	spec: string,
	baseDir: string,
	depth: number,
	line: string,
	state: ExpandState,
	sourceLabel: string,
): string {
	const target = resolveSpecifier(spec, baseDir, state.home);
	if (!target.ok) return report(spec, target.reason, line, state, sourceLabel);

	if (!isContained(target.path, state.roots)) {
		return report(spec, 'outside the project root', line, state, sourceLabel);
	}

	let isFile = false;
	try {
		isFile = statSync(target.path).isFile();
	} catch {
		return report(spec, 'file not found', line, state, sourceLabel);
	}
	if (!isFile) return report(spec, 'not a file', line, state, sourceLabel);

	const key = safeRealPath(target.path) ?? resolve(target.path);
	if (state.seen.has(key)) {
		return report(
			spec,
			'already included (circular import)',
			line,
			state,
			sourceLabel,
		);
	}
	if (depth + 1 > state.maxDepth) {
		return report(spec, 'nested too deeply', line, state, sourceLabel);
	}

	let raw: string;
	try {
		raw = readFileSync(target.path, 'utf-8');
	} catch {
		return report(spec, 'could not be read', line, state, sourceLabel);
	}

	// Same cap as tool output: one oversized file cannot push the rest of the
	// instruction set out of the context window.
	const capped = truncateToolResult(raw, MAX_TOOL_RESULT_CHARS);
	if (state.importedChars + capped.length > state.maxChars) {
		return report(
			spec,
			'over the import size budget',
			line,
			state,
			sourceLabel,
		);
	}

	state.seen.add(key);
	state.importedChars += capped.length;

	return expandContent(
		capped,
		dirname(target.path),
		depth + 1,
		state,
		labelFor(target.path, state),
	);
}

/**
 * A warning names the file the reference is written in, so a failure in
 * `.nanocoder/rules/style.md` does not send the reader to AGENTS.md.
 */
function report(
	spec: string,
	reason: string,
	line: string,
	state: ExpandState,
	sourceLabel: string,
): string {
	state.warnings.push(`${sourceLabel}: @${spec} was not imported (${reason})`);
	return line;
}

/** How a file is named in a warning: project-relative, then `~`-relative. */
function labelFor(filePath: string, state: ExpandState): string {
	const absolute = resolve(filePath);
	const fromRoot = relative(state.projectRoot, absolute);
	if (fromRoot && !fromRoot.startsWith('..') && !isAbsolute(fromRoot)) {
		return toPosix(fromRoot);
	}
	const fromHome = relative(resolve(state.home), absolute);
	if (fromHome && !fromHome.startsWith('..') && !isAbsolute(fromHome)) {
		return toPosix(`~/${fromHome}`);
	}
	return toPosix(absolute);
}

function toPosix(path: string): string {
	return sep === '/' ? path : path.split(sep).join('/');
}

/**
 * Only something that reads as a path is treated as an import: `@docs/x.md`,
 * `@style.md`, `@~/rules.md`. A bare `@word` stays as prose.
 */
function looksLikePath(spec: string): boolean {
	return (
		spec.startsWith('~/') ||
		spec.includes('/') ||
		/\.[A-Za-z0-9]{1,8}$/.test(spec)
	);
}

type Resolution = {ok: true; path: string} | {ok: false; reason: string};

/**
 * `@~/x` is home-relative; everything else is relative to the importing file
 * (so `../rules/style.md` works from `.nanocoder/rules/`). Absolute paths are
 * refused: an AGENTS.md cannot name a file by absolute path at all, which
 * keeps Windows drive paths and `/etc/passwd` out without a special case.
 *
 * Both spellings still go through the containment check, so `@~/...` only
 * resolves when the target happens to lie inside the project root — which is
 * why the docs do not advertise it as a way to reach user files.
 */
function resolveSpecifier(
	spec: string,
	baseDir: string,
	home: string,
): Resolution {
	if (spec.includes('\0')) return {ok: false, reason: 'invalid path'};
	if (spec === '~' || spec.startsWith('~/')) {
		return {ok: true, path: join(home, spec.slice(1))};
	}
	if (isAbsolute(spec) || /^[A-Za-z]:[/\\]/.test(spec)) {
		return {ok: false, reason: 'absolute paths are not allowed'};
	}
	return {ok: true, path: resolve(baseDir, spec)};
}

function toAllowedRoots(roots: string[]): AllowedRoot[] {
	const unique = new Map<string, AllowedRoot>();
	for (const root of roots) {
		const lexical = resolve(root);
		if (unique.has(lexical)) continue;
		unique.set(lexical, {lexical, real: safeRealPath(lexical)});
	}
	return [...unique.values()];
}

/**
 * Containment for a path that may be attacker-chosen. The lexical check keeps
 * out `../..` escapes; the real-path check keeps out in-repo symlinks that
 * point elsewhere. A path that does not exist yet (reported as "not found"
 * later) can still pass containment lexically, which is what makes the
 * missing-file message the one the user sees.
 */
function isContained(candidate: string, roots: AllowedRoot[]): boolean {
	const lexical = resolve(candidate);
	const real = safeRealPath(lexical);

	for (const root of roots) {
		if (isPathInside(lexical, root.lexical)) {
			if (!real || !root.real) return true;
			if (isPathInside(real, root.real)) return true;
			continue;
		}
		// The other spelling of the same directory: an in-project symlink whose
		// target is inside the root passes lexically outside it.
		if (real && root.real && isPathInside(real, root.real)) return true;
	}

	return false;
}

function safeRealPath(target: string): string | null {
	try {
		return realpathSync(target);
	} catch {
		return null;
	}
}
