import stripAnsi from 'strip-ansi';

/**
 * Truncate a string containing ANSI escape codes to fit a given visual width.
 * Preserves ANSI formatting while counting only visible characters.
 */
export function truncateAnsi(str: string, maxWidth: number): string {
	const plainText = stripAnsi(str);
	if (plainText.length <= maxWidth) return str;

	let visibleCount = 0;
	const ansiRegex = /\x1b\[[0-9;]*m/g;
	let result = '';
	let lastIndex = 0;

	let match: RegExpExecArray | null;
	while ((match = ansiRegex.exec(str)) !== null) {
		const textBefore = str.slice(lastIndex, match.index);
		for (const char of textBefore) {
			if (visibleCount >= maxWidth - 1) break;
			result += char;
			visibleCount++;
		}
		if (visibleCount >= maxWidth - 1) break;
		result += match[0];
		lastIndex = match.index + match[0].length;
	}

	if (visibleCount < maxWidth - 1) {
		const remaining = str.slice(lastIndex);
		for (const char of remaining) {
			if (visibleCount >= maxWidth - 1) break;
			result += char;
			visibleCount++;
		}
	}

	return result + '\x1b[0m…';
}
