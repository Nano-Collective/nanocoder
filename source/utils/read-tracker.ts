import {AsyncLocalStorage} from 'node:async_hooks';
import {resolve} from 'node:path';

/**
 * Session-scoped read-before-edit tracker.
 *
 * Small/local models frequently edit or overwrite files they have not actually
 * looked at, producing hallucinated `old_str` content or blind clobbering of a
 * file's existing contents. Forcing a Read before an Edit (and before
 * overwriting an existing file) turns that failure into a cheap, self-correcting
 * recovery path: the tool refuses, the model reads, then retries with content
 * that matches.
 *
 * The tracker records absolute paths the agent has either read (via read_file)
 * or written (via write_file / string_replace) during the process lifetime.
 * Writing counts as "seen" because the model just produced the content, so a
 * follow-up edit to the same file is not blind.
 *
 * State is intentionally global (not per-conversation): it errs toward
 * UNDER-enforcement across agents/subagents, which is safe — the worst case is
 * that a guard fails to fire. Over-enforcement (blocking a legitimate edit) is
 * the only outcome we must avoid, and `string_replace`'s exact-match validator
 * remains the backstop for stale reads.
 */
const seenFiles = new Set<string>();

type ReadContentEntry = {
	mtimeMs: number;
	size: number;
	generation: number;
	lineCount: number;
};

type ReadContentScope = {
	generation: number;
	files: Map<string, ReadContentEntry>;
};

const DEFAULT_READ_SCOPE = 'main';
const readContentScopes = new Map<string, ReadContentScope>();
const readContentScopeStorage = new AsyncLocalStorage<string>();

function currentReadScopeId(): string {
	return readContentScopeStorage.getStore() ?? DEFAULT_READ_SCOPE;
}

function getReadContentScope(scopeId = currentReadScopeId()): ReadContentScope {
	let scope = readContentScopes.get(scopeId);
	if (!scope) {
		scope = {generation: 0, files: new Map()};
		readContentScopes.set(scopeId, scope);
	}
	return scope;
}

function readContentKey(
	absPath: string,
	startLine?: number,
	endLine?: number,
): string {
	return `${resolve(absPath)}\0${startLine ?? ''}\0${endLine ?? ''}`;
}

/** Record that a file's contents have been seen this session (read or written). */
export function markFileSeen(absPath: string): void {
	seenFiles.add(resolve(absPath));
}

/** Whether a file's contents have been seen this session. */
export function hasSeenFile(absPath: string): boolean {
	return seenFiles.has(resolve(absPath));
}

/** Isolate stub state so a parent read cannot stub a subagent that never saw the file. */
export function runWithReadContentScope<T>(
	scopeId: string,
	fn: () => T,
): T {
	return readContentScopeStorage.run(scopeId, fn);
}

/** Invalidate stubs after compact. Does not clear the edit guard. */
export function bumpReadContentGeneration(): void {
	getReadContentScope().generation++;
}

/** Drop stub entries for a path after an edit. */
export function forgetReadContent(absPath: string): void {
	const resolved = resolve(absPath);
	const prefix = `${resolved}\0`;
	const files = getReadContentScope().files;
	for (const key of files.keys()) {
		if (key === resolved || key.startsWith(prefix)) {
			files.delete(key);
		}
	}
}

/** Remember a content-bearing read so a matching later call can stub. */
export function rememberReadContent(
	absPath: string,
	stats: {mtimeMs: number; size: number},
	lineCount: number,
	startLine?: number,
	endLine?: number,
): void {
	const scope = getReadContentScope();
	scope.files.set(readContentKey(absPath, startLine, endLine), {
		mtimeMs: stats.mtimeMs,
		size: stats.size,
		generation: scope.generation,
		lineCount,
	});
}

/** Same path + range, same mtime/size, same compact generation → stub. */
export function matchReadContent(
	absPath: string,
	stats: {mtimeMs: number; size: number},
	startLine?: number,
	endLine?: number,
): {lineCount: number; size: number} | undefined {
	const scope = getReadContentScope();
	const entry = scope.files.get(readContentKey(absPath, startLine, endLine));
	if (!entry) {
		return undefined;
	}
	if (entry.generation !== scope.generation) {
		return undefined;
	}
	if (entry.mtimeMs !== stats.mtimeMs || entry.size !== stats.size) {
		return undefined;
	}
	return {lineCount: entry.lineCount, size: entry.size};
}

/** Clear all tracked files. Called on /clear and exposed for tests. */
export function clearReadTracker(): void {
	seenFiles.clear();
	readContentScopes.clear();
}
