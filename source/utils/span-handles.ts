import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

/**
 * Content-addressed edit handles (`@span:k7`).
 *
 * `read_file` and `search_file_contents` tag the ranges they return with a
 * short handle. `replace_span` resolves a handle back to its file/line range
 * and recomputes the hash of what is actually there right now before editing,
 * so a model never has to retype the exact source text the way `string_replace`
 * requires — and an edit against content that has since moved or changed
 * (including from a sibling span's own edit shifting these lines) fails with a
 * clear error instead of corrupting the file.
 *
 * State is a single process-global, insertion-ordered map, deliberately not
 * scoped per conversation or subagent: an edit is safe exactly when the
 * content hash still matches, regardless of how long ago the handle was
 * issued, so there is no correctness reason to invalidate handles on compact.
 * The only real risk from a long session is unbounded growth, which the FIFO
 * cap below addresses the same way `expandableResults` does in
 * tool-result-display.tsx.
 */

interface SpanHandleEntry {
	path: string;
	startLine: number;
	endLine: number;
	contentHash: string;
}

const MAX_SPAN_HANDLES = 500;
const handles = new Map<string, SpanHandleEntry>();
let nextHandleId = 1;

const HANDLE_PREFIX = '@span:';

function hashContent(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

/** The exact slice `replace_span` will hash back against on resolution. */
export function extractLineRange(
	content: string,
	startLine: number,
	endLine: number,
): string {
	return content
		.split('\n')
		.slice(startLine - 1, endLine)
		.join('\n');
}

/**
 * Register a handle for `[startLine, endLine]` (1-indexed, inclusive), hashing
 * `exactContent` as-is. Returns the `@span:xx` string to embed in tool output.
 */
export function registerSpanWithContent(
	path: string,
	startLine: number,
	endLine: number,
	exactContent: string,
): string {
	const id = (nextHandleId++).toString(36);
	handles.set(id, {
		path,
		startLine,
		endLine,
		contentHash: hashContent(exactContent),
	});
	if (handles.size > MAX_SPAN_HANDLES) {
		const oldest = handles.keys().next().value;
		if (oldest !== undefined) handles.delete(oldest);
	}
	return `${HANDLE_PREFIX}${id}`;
}

/**
 * Register a handle for `[startLine, endLine]` (1-indexed, inclusive) of
 * `fullContent`, which the caller has already read.
 */
export function registerSpanForRange(
	path: string,
	startLine: number,
	endLine: number,
	fullContent: string,
): string {
	return registerSpanWithContent(
		path,
		startLine,
		endLine,
		extractLineRange(fullContent, startLine, endLine),
	);
}

export type SpanResolution =
	| {status: 'unknown'}
	| {status: 'file-missing'; path: string}
	| {status: 'stale'; path: string}
	| {
			status: 'ok';
			path: string;
			startLine: number;
			endLine: number;
			fullContent: string;
	  };

/** Resolve a handle, re-checking its content hash against the live file. */
export async function resolveSpanHandle(
	handle: string,
): Promise<SpanResolution> {
	const id = handle.startsWith(HANDLE_PREFIX)
		? handle.slice(HANDLE_PREFIX.length)
		: handle;
	const entry = handles.get(id);
	if (!entry) {
		return {status: 'unknown'};
	}

	let fullContent: string;
	try {
		fullContent = await readFile(entry.path, 'utf-8');
	} catch {
		return {status: 'file-missing', path: entry.path};
	}

	const liveHash = hashContent(
		extractLineRange(fullContent, entry.startLine, entry.endLine),
	);
	if (liveHash !== entry.contentHash) {
		return {status: 'stale', path: entry.path};
	}

	return {
		status: 'ok',
		path: entry.path,
		startLine: entry.startLine,
		endLine: entry.endLine,
		fullContent,
	};
}

/** Drop a handle once it has been applied, so a replay fails as unknown. */
export function consumeSpanHandle(handle: string): void {
	const id = handle.startsWith(HANDLE_PREFIX)
		? handle.slice(HANDLE_PREFIX.length)
		: handle;
	handles.delete(id);
}

/** Clear all handles. Called on /clear and exposed for tests. */
export function clearSpanHandles(): void {
	handles.clear();
	nextHandleId = 1;
}
