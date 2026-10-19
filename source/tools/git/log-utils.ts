/**
 * CI Log Query Utilities
 *
 * `gh run view --log` / `--log-failed` output can run to thousands of lines,
 * far more than fits an LLM context window. `queryCiLog` gives callers a way
 * to either page through the tail of a log (failures are usually near the
 * end) or search it for a substring with surrounding context, so a tool can
 * hand back a bounded, useful slice instead of the whole thing.
 *
 * Pure string-in/string-out — no gh/child_process dependency — so it's
 * testable without a real CI run.
 */

const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 2000;
const DEFAULT_CONTEXT_LINES = 2;

export interface LogQueryOptions {
	/** Case-insensitive substring match. When set, pagination is ignored. */
	search?: string;
	/** Line offset. Without `search`, counts back from the end of the log. */
	offset?: number;
	/** Max lines returned. Default 300, hard-capped at 2000. */
	limit?: number;
	/** Lines of context kept around each search match. Default 2. */
	contextLines?: number;
}

export interface LogQueryResult {
	content: string;
	totalLines: number;
	truncated: boolean;
	/** Only set when `search` is used. */
	matchCount?: number;
}

function resolveLimit(limit?: number): number {
	if (!limit || limit <= 0) return DEFAULT_LIMIT;
	return Math.min(limit, MAX_LIMIT);
}

function paginateTail(
	lines: string[],
	offset: number,
	limit: number,
): LogQueryResult {
	const totalLines = lines.length;
	// offset counts back from the end: offset=0 means "the last `limit`
	// lines", offset=200 means "skip the most recent 200 lines, then take
	// `limit` lines before that". An offset overshooting the log (nothing
	// left to skip to) saturates at the earliest `limit` lines instead of
	// returning nothing.
	let end = Math.max(totalLines - offset, 0);
	if (end === 0 && totalLines > 0) {
		end = Math.min(limit, totalLines);
	}
	const start = Math.max(end - limit, 0);
	const content = lines.slice(start, end).join('\n');
	const truncated = start > 0 || end < totalLines;

	if (!truncated) {
		return {content, totalLines, truncated: false};
	}

	const marker =
		`... [Log truncated: showing lines ${start + 1}-${end} of ${totalLines}; ` +
		`pass logs.offset=${totalLines - start} to see earlier lines]`;
	return {
		content: content ? `${marker}\n\n${content}` : marker,
		totalLines,
		truncated: true,
	};
}

function searchLines(
	lines: string[],
	search: string,
	contextLines: number,
	limit: number,
): LogQueryResult {
	const totalLines = lines.length;
	const needle = search.toLowerCase();
	const keep = new Set<number>();
	let matchCount = 0;

	for (let i = 0; i < lines.length; i++) {
		if (lines[i].toLowerCase().includes(needle)) {
			matchCount++;
			for (
				let j = Math.max(0, i - contextLines);
				j <= Math.min(lines.length - 1, i + contextLines);
				j++
			) {
				keep.add(j);
			}
		}
	}

	if (matchCount === 0) {
		return {
			content: `No matches for "${search}" in ${totalLines} lines.`,
			totalLines,
			truncated: false,
			matchCount: 0,
		};
	}

	const keptIndices = Array.from(keep).sort((a, b) => a - b);
	// Keep the *latest* matches, not the earliest: CI failures are typically
	// near the end of the log, so truncating from the front would silently
	// drop the root cause on a noisy log with many matches.
	const limited = keptIndices.slice(-limit);
	const truncated = limited.length < keptIndices.length;

	const contentLines: string[] = [];
	let previous = -2;
	for (const idx of limited) {
		if (idx !== previous + 1 && contentLines.length > 0) {
			contentLines.push('--');
		}
		contentLines.push(lines[idx]);
		previous = idx;
	}

	let content = contentLines.join('\n');
	if (truncated) {
		content += `\n\n... [${matchCount} matches for "${search}"; showing last ${limited.length} of ${keptIndices.length} context lines]`;
	}

	return {content, totalLines, truncated, matchCount};
}

/**
 * Query a CI log for a bounded, useful slice: either the tail (paginated
 * via `offset`/`limit`) or lines matching `search` (with surrounding
 * context), so a tool can avoid returning an entire multi-thousand-line log.
 */
export function queryCiLog(
	log: string,
	options?: LogQueryOptions,
): LogQueryResult {
	const lines = log.length === 0 ? [] : log.split('\n');
	const limit = resolveLimit(options?.limit);

	if (options?.search) {
		return searchLines(
			lines,
			options.search,
			options.contextLines ?? DEFAULT_CONTEXT_LINES,
			limit,
		);
	}

	return paginateTail(lines, Math.max(options?.offset ?? 0, 0), limit);
}
