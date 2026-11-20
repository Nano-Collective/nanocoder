const ARGUMENT_QUOTE_CHARS = new Set(['"', "'", '`']);

/**
 * A backslash only escapes a quote, whitespace or another backslash. Anywhere
 * else it stays literal, so Windows paths such as C:\src\app.ts survive.
 */
function isEscapable(char: string): boolean {
	return ARGUMENT_QUOTE_CHARS.has(char) || char === '\\' || /\s/.test(char);
}

/**
 * Parses command arguments while preserving quoted multi-word values.
 */
export function parseCustomCommandArgs(input: string): string[] {
	const args: string[] = [];
	let currentArg = '';
	let quoteChar: string | null = null;
	let hasCurrentArg = false;

	const chars = [...input.trim()];
	for (let index = 0; index < chars.length; index++) {
		const char = chars[index];

		if (char === '\\') {
			const next = chars[index + 1];
			if (next !== undefined && isEscapable(next)) {
				currentArg += next;
				index++;
			} else {
				currentArg += char;
			}
			hasCurrentArg = true;
			continue;
		}

		if (quoteChar) {
			if (char === quoteChar) {
				quoteChar = null;
			} else {
				currentArg += char;
			}
			hasCurrentArg = true;
			continue;
		}

		if (ARGUMENT_QUOTE_CHARS.has(char)) {
			quoteChar = char;
			hasCurrentArg = true;
			continue;
		}

		if (/\s/.test(char)) {
			if (hasCurrentArg) {
				args.push(currentArg);
				currentArg = '';
				hasCurrentArg = false;
			}
			continue;
		}

		currentArg += char;
		hasCurrentArg = true;
	}

	if (hasCurrentArg) {
		args.push(currentArg);
	}

	return args;
}
