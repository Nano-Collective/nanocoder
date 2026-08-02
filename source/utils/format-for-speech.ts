export interface FormatForSpeechOptions {
	maxLength?: number;
}

export function formatForSpeech(
	text: string,
	options: FormatForSpeechOptions = {},
): string {
	const {maxLength = 500} = options;

	let result = text;

	// 1. Strip ANSI escape codes
	// eslint-disable-next-line no-control-regex
	result = result.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

	// 2. Collapse fenced code blocks
	// We'll replace blocks with more than 3 lines of code with a summary.
	result = result.replace(/```(?:[^\n]*\n)([\s\S]*?)```/g, (match, code) => {
		const lines = code.trim().split('\n');
		if (lines.length > 3) {
			return `[code block, ${lines.length} lines]`;
		}
		return code.trim();
	});

	// 3. Collapse stack traces (look for "Error: ..." followed by "    at ...")
	result = result.replace(
		/([^\n]*Error[^\n]*\n)((?:(?:\s+at\s+)[^\n]+\n?)+)/g,
		(match, firstLine, frames) => {
			const frameLines = frames.trim().split('\n');
			if (frameLines.length > 0) {
				return `${firstLine.trim()}\n[stack trace, ${frameLines.length} frames]\n`;
			}
			return match;
		},
	);

	// 4. Strip markdown syntax
	// Headings
	result = result.replace(/^#{1,6}\s+(.*)$/gm, '$1');
	// Bold/Italic (**, *, __, _)
	result = result.replace(/(\*\*|__)(.*?)\1/g, '$2');
	result = result.replace(/(\*|_)(.*?)\1/g, '$2');
	// Links: [text](url) -> text
	result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
	// Blockquotes
	result = result.replace(/^>\s+(.*)$/gm, '$1');
	// List markers (-, *, +, 1.)
	result = result.replace(/^(\s*)([-*+]|\d+\.)\s+/gm, '$1');

	// 5. Abbreviate long absolute file paths
	// Find strings like /foo/bar/baz/qux.ts or C:\foo\bar\baz.ts
	result = result.replace(
		/(?:[a-zA-Z]:\\|\/)(?:[^\\\/\n]+[\\\/])+[^\\\/\n]+/g,
		match => {
			const sep = match.includes('\\') ? '\\' : '/';
			const parts = match.split(sep);
			// Keep first 2 and last 2, replace middle with ...
			// E.g., /a/b/c/d/e.ts -> /a/.../e.ts
			if (parts.length > 4) {
				// parts[0] is drive letter or empty string, parts[1] is first dir
				const start = 2;
				// just keep first folder and last file
				return `${parts.slice(0, start).join(sep)}${sep}...${sep}${parts[parts.length - 1]}`;
			}
			return match;
		},
	);

	// 6. Normalize whitespace
	// Collapse multiple newlines into a single space, or maybe just two newlines into one.
	// We want it to sound continuous but keep some breaks.
	// Actually, for speech, collapsing multiple newlines to a single space or period-space is good.
	// We'll replace 2+ newlines with a single newline or space. Let's just use single newlines,
	// and multiple spaces to single spaces.
	result = result.replace(/\n{2,}/g, '\n');
	result = result.replace(/ {2,}/g, ' ');
	result = result.trim();

	// 7. Truncate
	if (result.length > maxLength) {
		const truncated = result.slice(0, maxLength);
		// Try to cut at a word boundary
		const lastSpace = truncated.lastIndexOf(' ');
		if (lastSpace > maxLength * 0.8) {
			result =
				truncated.slice(0, lastSpace) +
				`... [${result.length - lastSpace} characters omitted]`;
		} else {
			result =
				truncated + `... [${result.length - maxLength} characters omitted]`;
		}
	}

	return result;
}
