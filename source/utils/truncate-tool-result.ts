import {MAX_TOOL_RESULT_CHARS} from '@/constants';

const HEAD_SHARE = 0.4;

// Matches prompt-scrub's placeholder token exactly (see
// @nanocollective/prompt-scrub's rehydrate.ts). Scrubbing runs before this
// truncation's own caller re-truncates a result that expanded past the cap
// (placeholders can be longer than what they replace), so a cut has to know
// about these tokens to avoid landing inside one.
const PLACEHOLDER_PATTERN = /«[A-Za-z]+_\d+»/g;

function createElisionMarker(totalLength: number): string {
	return `\n... [Output truncated: ${totalLength} characters total; request a narrower result to inspect omitted content] ...\n`;
}

/**
 * If `index` falls strictly inside a «Category_N» placeholder token, move it
 * to the token's start (`bias: 'before'`) or end (`bias: 'after'`) so the cut
 * excludes the token whole instead of splitting it. Both directions push the
 * cut away from the kept content and into the elided middle, so the result
 * never grows past the caller's budget.
 */
function snapOutsidePlaceholder(
	content: string,
	index: number,
	bias: 'before' | 'after',
): number {
	for (const match of content.matchAll(PLACEHOLDER_PATTERN)) {
		const start = match.index ?? 0;
		const end = start + match[0].length;
		if (index > start && index < end) {
			return bias === 'before' ? start : end;
		}
		if (start > index) break;
	}
	return index;
}

/**
 * Bound text returned by a tool before it is added to model context.
 *
 * Keeping the tail is important for compiler, test-runner, and command output,
 * where the actionable summary usually appears after the verbose beginning.
 */
export function truncateToolResult(
	content: string,
	maxLength = MAX_TOOL_RESULT_CHARS,
): string {
	if (content.length <= maxLength) return content;
	if (maxLength <= 0) return '';

	const marker = createElisionMarker(content.length);
	const contentBudget = maxLength - marker.length;
	if (contentBudget <= 0) return marker.slice(0, maxLength);

	const headLength = Math.floor(contentBudget * HEAD_SHARE);
	const tailLength = contentBudget - headLength;

	const headEnd = snapOutsidePlaceholder(content, headLength, 'before');
	const tailStart = Math.max(
		headEnd,
		snapOutsidePlaceholder(content, content.length - tailLength, 'after'),
	);

	return content.slice(0, headEnd) + marker + content.slice(tailStart);
}
