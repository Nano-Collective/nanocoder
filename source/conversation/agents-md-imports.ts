import {readFileSync, realpathSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {getConfigPath} from '@/config/platform-dirs';
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
 * - every import must resolve inside the project root or the user config
 *   directory, checked again after resolving symlinks, so an in-repo link
 *   cannot point the model at `~/.ssh`;
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

/** A whole line that is nothing but a reference, optionally indented. */
const IMPORT_LINE = /^\s*@(\S+)\s*$/;

/** Fence opener/closer: ``` or ~~~ (three or more, either character). */
const FENCE = /^\s*(`{3,}|~{3,})/;

export interface AgentsMdImportOptions {
	/** Absolute path of the AGENTS.md being expanded. */
	filePath: string;
	/** Project root; imports must stay inside it. */
	projectRoot: string;
	/** User config directory, the other allowed root. Defaults to the platform one. */
	configDir?: string;
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
		roots: toAllowedRoots([
			options.projectRoot,
			options.configDir ?? getConfigPath(),
		]),
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
		content: expandContent(content, dirname(options.filePath), 0, state),
		warnings: state.warnings,
	};
}

/** Walks the lines, leaving fenced code and plain prose untouched. */
function expandContent(
	content: string,
	baseDir: string,
	depth: number,
	state: ExpandState,
): string {
	const lines = content.split(/\r?\n/);
	const output: string[] = [];
	let fence: string | null = null;

	for (const line of lines) {
		const fenceMatch = line.match(FENCE);
		if (fenceMatch) {
			const character = (fenceMatch[1] ?? '`')[0] ?? '`';
			if (fence === null) {
				fence = character;
			} else if (fence === character) {
				fence = null;
			}
			output.push(line);
			continue;
		}

		if (fence !== null) {
			output.push(line);
			continue;
		}

		const importMatch = line.match(IMPORT_LINE);
		if (!importMatch) {
			output.push(line);
			continue;
		}

		output.push(
			expandImport(importMatch[1] ?? '', baseDir, depth, line, state),
		);
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
): string {
	const target = resolveSpecifier(spec, baseDir, state.home);
	if (!target.ok) return report(spec, target.reason, line, state);

	if (!isContained(target.path, state.roots)) {
		return report(spec, 'outside the project root', line, state);
	}

	let isFile = false;
	try {
		isFile = statSync(target.path).isFile();
	} catch {
		return report(spec, 'file not found', line, state);
	}
	if (!isFile) return report(spec, 'not a file', line, state);

	const key = safeRealPath(target.path) ?? resolve(target.path);
	if (state.seen.has(key)) {
		return report(spec, 'already included (circular import)', line, state);
	}
	if (depth + 1 > state.maxDepth) {
		return report(spec, 'nested too deeply', line, state);
	}

	let raw: string;
	try {
		raw = readFileSync(target.path, 'utf-8');
	} catch {
		return report(spec, 'could not be read', line, state);
	}

	// Same cap as tool output: one oversized file cannot push the rest of the
	// instruction set out of the context window.
	const capped = truncateToolResult(raw, MAX_TOOL_RESULT_CHARS);
	if (state.importedChars + capped.length > state.maxChars) {
		return report(spec, 'over the import size budget', line, state);
	}

	state.seen.add(key);
	state.importedChars += capped.length;

	return expandContent(capped, dirname(target.path), depth + 1, state);
}

function report(
	spec: string,
	reason: string,
	line: string,
	state: ExpandState,
): string {
	state.warnings.push(`AGENTS.md: @${spec} was not imported (${reason})`);
	return line;
}

type Resolution = {ok: true; path: string} | {ok: false; reason: string};

/**
 * `@~/x` is home-relative; everything else is relative to the importing file
 * (so `../rules/style.md` works from `.nanocoder/rules/`). Absolute paths are
 * refused: an AGENTS.md cannot name a file by absolute path at all, which
 * keeps Windows drive paths and `/etc/passwd` out without a special case.
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
