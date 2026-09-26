/**
 * Format a subagent tool result, adding an ellipsis only when text was cut.
 *
 * @param name - Tool name
 * @param content - Full tool result
 * @param limit - Maximum characters to keep before the ellipsis
 * @returns The transcript line
 */
export function formatSubagentToolResult(
	name: string,
	content: string,
	limit = 100,
): string {
	const preview =
		content.length > limit ? `${content.slice(0, limit)}...` : content;
	return `⚒ ${name}: ${preview}`;
}
