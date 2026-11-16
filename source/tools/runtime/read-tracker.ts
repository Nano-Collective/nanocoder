import {AsyncLocalStorage} from 'node:async_hooks';
import {statSync} from 'node:fs';
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
	visibilityReceipts: Map<string, VisibilityReceipt>;
};

type LineRange = {
	start: number;
	end: number;
};

type VisibilityReceipt = {
	mtimeMs: number;
	size: number;
	generation: number;
	/** Line ranges the agent has actually seen. Empty array means full file. */
	visibleRanges: LineRange[];
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
		scope = {generation: 0, files: new Map(), visibilityReceipts: new Map()};
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

/**
 * Test helper: mark a file as both seen and fully visible.
 * Use this in tests that need to edit files after marking them seen.
 */
export function markFileSeenAndVisible(absPath: string): void {
	const normalized = resolve(absPath);
	seenFiles.add(normalized);
	recordVisibilityReceipt(normalized);
}

/** Whether a file's contents have been seen this session. */
export function hasSeenFile(absPath: string): boolean {
	return seenFiles.has(resolve(absPath));
}

/** Isolate stub state so a parent read cannot stub a subagent that never saw the file. */
export function runWithReadContentScope<T>(scopeId: string, fn: () => T): T {
	return readContentScopeStorage.run(scopeId, fn);
}

/** Invalidate stubs after compact. Does not clear the edit guard. */
export function bumpReadContentGeneration(): void {
	getReadContentScope().generation++;
}

/** Drop stub entries for a path after an edit. */
export function forgetReadContent(absPath: string): void {
	const prefix = `${resolve(absPath)}\0`;
	const files = getReadContentScope().files;
	for (const key of files.keys()) {
		if (key.startsWith(prefix)) {
			files.delete(key);
		}
	}
}

/**
 * Drop the stub entry for one path + range: its body has left the context
 * the model sees (e.g. the message cap dropped it), so a repeat read must
 * return the content again.
 */
export function forgetReadContentRange(
	absPath: string,
	startLine?: number,
	endLine?: number,
): void {
	getReadContentScope().files.delete(
		readContentKey(absPath, startLine, endLine),
	);
}

/** Text every read_file stub carries, so callers can tell a stub from a body. */
export const READ_STUB_MARKER = 'already in context, unchanged since last read';

/**
 * Whether a read_file result is a stub rather than a body. Matches the whole
 * one-line shape, not just the marker, so reading a file that happens to
 * contain the marker text (this one) still counts as a body.
 */
export function isReadStub(content: string): boolean {
	return (
		content.startsWith('[file: ') &&
		content.endsWith(']') &&
		!content.includes('\n') &&
		content.includes(READ_STUB_MARKER)
	);
}

/** Drop a subagent's stub map when that agent finishes. */
export function clearReadContentScope(scopeId: string): void {
	readContentScopes.delete(scopeId);
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

/**
 * Visibility Receipt System - Line-level read tracking
 *
 * Records exactly which lines an agent has read, preventing blind edits to
 * unseen code. This is the enforcement layer for issue #1573.
 */

/**
 * Record a visibility receipt: the agent has read specific lines of a file.
 *
 * @param absPath - Absolute path to the file
 * @param stats - File stats (mtime, size) for staleness detection. If undefined, will be fetched synchronously.
 * @param startLine - First line read (1-indexed), undefined means full file
 * @param endLine - Last line read (1-indexed), undefined means full file
 */
export function recordVisibilityReceipt(
	absPath: string,
	stats?: {mtimeMs: number; size: number},
	startLine?: number,
	endLine?: number,
): void {
	const scope = getReadContentScope();
	const path = resolve(absPath);
	const existing = scope.visibilityReceipts.get(path);

	// Fetch stats if not provided (for test helpers like markFileSeen)
	if (!stats) {
		try {
			const fileStats = statSync(path);
			stats = {mtimeMs: fileStats.mtimeMs, size: fileStats.size};
		} catch {
			// If file doesn't exist or can't be stat'd, skip recording visibility
			return;
		}
	}

	// Full file read (no start/end specified)
	if (startLine === undefined || endLine === undefined) {
		scope.visibilityReceipts.set(path, {
			mtimeMs: stats.mtimeMs,
			size: stats.size,
			generation: scope.generation,
			visibleRanges: [], // Empty array signals full file visibility
		});
		return;
	}

	// Range read - merge with existing ranges
	const newRange: LineRange = {start: startLine, end: endLine};

	if (!existing || existing.generation !== scope.generation) {
		// First read in this generation
		scope.visibilityReceipts.set(path, {
			mtimeMs: stats.mtimeMs,
			size: stats.size,
			generation: scope.generation,
			visibleRanges: [newRange],
		});
		return;
	}

	// File changed externally - replace receipt
	if (existing.mtimeMs !== stats.mtimeMs || existing.size !== stats.size) {
		scope.visibilityReceipts.set(path, {
			mtimeMs: stats.mtimeMs,
			size: stats.size,
			generation: scope.generation,
			visibleRanges: [newRange],
		});
		return;
	}

	// The whole file is already visible (empty list means full file), so a range
	// read adds nothing. Pushing onto it would turn "full file" into one range.
	if (existing.visibleRanges.length === 0) {
		return;
	}

	// Merge ranges - add new range to existing
	existing.visibleRanges.push(newRange);
}

/**
 * Keep a file's visibility receipt in step with an edit the agent just made.
 *
 * An edit changes the file's mtime/size, so the old receipt would no longer
 * match and everything the agent had read would be forgotten, forcing a re-read
 * after every edit. The agent knows what it wrote and what it read before, so
 * instead: lines before the edit stay as they were, lines after it move by the
 * change in line count, and the edited region counts as seen.
 *
 * @param stats - File stats after the write
 * @param startLine - First line the edit touched (1-indexed)
 * @param oldLineCount - Number of lines the replaced text spanned
 * @param newLineCount - Number of lines the replacement spans
 */
export function recordEditVisibility(
	absPath: string,
	stats: {mtimeMs: number; size: number},
	startLine: number,
	oldLineCount: number,
	newLineCount: number,
): void {
	const scope = getReadContentScope();
	const path = resolve(absPath);
	const existing = scope.visibilityReceipts.get(path);
	const editedRange: LineRange = {
		start: startLine,
		end: startLine + Math.max(newLineCount, 1) - 1,
	};

	// Nothing trusted before the edit: the agent only knows what it wrote.
	if (!existing || existing.generation !== scope.generation) {
		scope.visibilityReceipts.set(path, {
			mtimeMs: stats.mtimeMs,
			size: stats.size,
			generation: scope.generation,
			visibleRanges: [editedRange],
		});
		return;
	}

	// The whole file was visible and the agent wrote the changed part, so it
	// still is. (An empty list means full file.)
	if (existing.visibleRanges.length === 0) {
		existing.mtimeMs = stats.mtimeMs;
		existing.size = stats.size;
		return;
	}

	const oldEnd = startLine + Math.max(oldLineCount, 1) - 1;
	const delta = Math.max(newLineCount, 1) - Math.max(oldLineCount, 1);
	const next: LineRange[] = [];
	for (const range of existing.visibleRanges) {
		if (range.end < startLine) {
			next.push(range);
			continue;
		}
		if (range.start > oldEnd) {
			next.push({start: range.start + delta, end: range.end + delta});
			continue;
		}
		// The range overlaps the edited lines: keep the parts outside them.
		if (range.start < startLine) {
			next.push({start: range.start, end: startLine - 1});
		}
		if (range.end > oldEnd) {
			next.push({start: oldEnd + 1 + delta, end: range.end + delta});
		}
	}
	next.push(editedRange);

	existing.mtimeMs = stats.mtimeMs;
	existing.size = stats.size;
	existing.visibleRanges = next;
}

/**
 * Check if specific lines are visible (have been read by the agent).
 *
 * @param absPath - Absolute path to the file
 * @param stats - Current file stats for staleness check
 * @param targetLines - Array of line numbers to check (1-indexed)
 * @returns Object with visibility status and error message if not visible
 */
export function hasVisibleLines(
	absPath: string,
	stats: {mtimeMs: number; size: number},
	targetLines: number[],
): {visible: boolean; error?: string} {
	const scope = getReadContentScope();
	const path = resolve(absPath);
	const receipt = scope.visibilityReceipts.get(path);

	if (!receipt) {
		return {
			visible: false,
			error: `You have not read "${absPath}". Call read_file first to see the file's actual content.`,
		};
	}

	// Check generation (invalidated by compaction)
	if (receipt.generation !== scope.generation) {
		return {
			visible: false,
			error: `Your previous read of "${absPath}" was invalidated by context compaction. Re-read the file before editing.`,
		};
	}

	// Check file hasn't changed externally
	if (receipt.mtimeMs !== stats.mtimeMs || receipt.size !== stats.size) {
		return {
			visible: false,
			error: `File "${absPath}" has been modified externally since you last read it (mtime or size changed). Re-read before editing.`,
		};
	}

	// Full file visibility
	if (receipt.visibleRanges.length === 0) {
		return {visible: true};
	}

	// Check if all target lines are covered by visible ranges
	for (const line of targetLines) {
		let covered = false;
		for (const range of receipt.visibleRanges) {
			if (line >= range.start && line <= range.end) {
				covered = true;
				break;
			}
		}
		if (!covered) {
			const visibleRangesStr = receipt.visibleRanges
				.map(r => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`))
				.join(', ');
			return {
				visible: false,
				error: `Line ${line} in "${absPath}" has not been read. You've only seen lines: ${visibleRangesStr}. Use read_file with start_line and end_line to read the target range first.`,
			};
		}
	}

	return {visible: true};
}

/**
 * Get line numbers from content string.
 * Used to extract which lines would be affected by an edit.
 * Normalizes CRLF to LF before counting to ensure consistent line numbering.
 *
 * @param fileContent - Full file content
 * @param searchText - Text to find in the file
 * @returns Array of line numbers (1-indexed) where the text appears
 */
export function getLineNumbersForText(
	fileContent: string,
	searchText: string,
): number[] {
	// Normalize line endings to LF for consistent line counting
	const normalizedContent = fileContent.replace(/\r\n/g, '\n');
	const normalizedSearch = searchText.replace(/\r\n/g, '\n');

	const searchLines = normalizedSearch.split('\n');
	const targetLines: number[] = [];

	// Find the starting position
	const index = normalizedContent.indexOf(normalizedSearch);
	if (index === -1) {
		return [];
	}

	// Count lines before the match
	const beforeMatch = normalizedContent.slice(0, index);
	const startLine = beforeMatch.split('\n').length;

	// Add all lines covered by the search text
	for (let i = 0; i < searchLines.length; i++) {
		targetLines.push(startLine + i);
	}

	return targetLines;
}

/** Clear visibility receipts for a file after an edit. */
export function forgetVisibilityReceipt(absPath: string): void {
	const scope = getReadContentScope();
	scope.visibilityReceipts.delete(resolve(absPath));
}

/**
 * Invalidate all visibility receipts (called on context compaction).
 * Receipts are cleared because the model's understanding of the code
 * may have been compressed/summarized.
 */
export function invalidateAllVisibilityReceipts(): void {
	const scope = getReadContentScope();
	scope.visibilityReceipts.clear();
}
