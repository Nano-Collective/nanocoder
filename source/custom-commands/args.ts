const ARGUMENT_QUOTE_CHARS = new Set(['"', "'", '`']);

/**
 * Parses command arguments while preserving quoted multi-word values.
 */
export function parseCustomCommandArgs(input: string): string[] {
	const args: string[] = [];
	let currentArg = '';
	let quoteChar: string | null = null;
	let isEscaped = false;
	let hasCurrentArg = false;

	for (const char of input.trim()) {
		if (isEscaped) {
			currentArg += char;
			hasCurrentArg = true;
			isEscaped = false;
			continue;
		}

		if (char === '\\') {
			isEscaped = true;
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

	if (isEscaped) {
		currentArg += '\\';
		hasCurrentArg = true;
	}

	if (hasCurrentArg) {
		args.push(currentArg);
	}

	return args;
}
