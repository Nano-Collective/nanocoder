/**
 * Whitespace / range helpers shared by the XML and text tool-call parsers.
 * Kept dependency-free so both parsers can import it without a cycle
 * (tool-parser already imports xml-parser).
 */

/**
 * Normalize whitespace artifacts left after stripping tool calls: trailing
 * spaces, runs of spaces mid-line, whitespace-only lines, and 3+ blank lines.
 */
export function normalizeWhitespace(content: string): string {
	return (
		content
			// Remove trailing whitespace from each line
			.replace(/[ \t]+$/gm, '')
			// Collapse multiple spaces (but not at start of line for indentation)
			.replace(/([^ \t\n]) {2,}/g, '$1 ')
			// Remove lines that are only whitespace
			.replace(/^[ \t]+$/gm, '')
			// Collapse 3+ consecutive newlines to exactly 2 (one blank line)
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

/**
 * Remove the given `[start, end)` ranges from content. Splices from the end
 * (ranges sorted descending) so each removal leaves earlier offsets valid.
 */
export function removeRanges(
	content: string,
	ranges: Array<[number, number]>,
): string {
	let result = content;
	for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0])) {
		result = result.slice(0, start) + result.slice(end);
	}
	return result;
}
