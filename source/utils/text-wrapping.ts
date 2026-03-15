import wrapAnsi from 'wrap-ansi';

/**
 * Ink uses wrap-ansi with trim: false, which preserves the space at word
 * boundaries as leading whitespace on continuation lines. This function
 * wraps each original line individually and trims only the artifact spaces
 * from continuation lines, preserving intentional indentation.
 */
export function wrapWithTrimmedContinuations(
	text: string,
	width: number,
): string {
	if (width <= 0) return text;
	const originalLines = text.split('\n');
	const result: string[] = [];

	for (const line of originalLines) {
		if (line === '') {
			result.push('');
			continue;
		}
		const wrapped = wrapAnsi(line, width, {trim: false, hard: true});
		const subLines = wrapped.split('\n');

		result.push(subLines[0] ?? '');

		for (let i = 1; i < subLines.length; i++) {
			// Trim the leading space that is a word-wrap artifact.
			// Handle ANSI escape codes that may precede the space.
			result.push(
				(subLines[i] ?? '').replace(/^((?:\x1b\[[0-9;]*m)*)\s/, '$1'),
			);
		}
	}

	return result.join('\n');
}
