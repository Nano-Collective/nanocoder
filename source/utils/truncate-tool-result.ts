import {MAX_TOOL_RESULT_CHARS} from '@/constants';

const HEAD_SHARE = 0.4;

function createElisionMarker(totalLength: number): string {
	return `\n... [Output truncated: ${totalLength} characters total; request a narrower result to inspect omitted content] ...\n`;
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

	return (
		content.slice(0, headLength) +
		marker +
		content.slice(content.length - tailLength)
	);
}
