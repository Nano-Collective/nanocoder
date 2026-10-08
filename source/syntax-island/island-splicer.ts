import type {IslandSplicingResult, SyntaxIsland} from '@/types/syntax-island';

/**
 * Validates delimiter balance in a snippet of code.
 */
export function validateDelimiterBalance(code: string): {
	valid: boolean;
	error?: string;
} {
	const stack: Array<{char: string; index: number}> = [];
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let inTemplateLiteral = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = 0; i < code.length; i++) {
		const char = code[i];
		const nextChar = code[i + 1];
		const prevChar = i > 0 ? code[i - 1] : '';

		if (inLineComment) {
			if (char === '\n') inLineComment = false;
			continue;
		}

		if (inBlockComment) {
			if (char === '*' && nextChar === '/') {
				inBlockComment = false;
				i++;
			}
			continue;
		}

		if (inSingleQuote) {
			if (char === "'" && prevChar !== '\\') inSingleQuote = false;
			continue;
		}

		if (inDoubleQuote) {
			if (char === '"' && prevChar !== '\\') inDoubleQuote = false;
			continue;
		}

		if (inTemplateLiteral) {
			if (char === '`' && prevChar !== '\\') inTemplateLiteral = false;
			continue;
		}

		if (char === '/' && nextChar === '/') {
			inLineComment = true;
			i++;
			continue;
		}

		if (char === '/' && nextChar === '*') {
			inBlockComment = true;
			i++;
			continue;
		}

		if (char === "'") {
			inSingleQuote = true;
			continue;
		}

		if (char === '"') {
			inDoubleQuote = true;
			continue;
		}

		if (char === '`') {
			inTemplateLiteral = true;
			continue;
		}

		if (char === '{' || char === '(' || char === '[') {
			stack.push({char, index: i});
		} else if (char === '}' || char === ')' || char === ']') {
			if (stack.length === 0) {
				return {
					valid: false,
					error: `Unexpected closing '${char}' with no matching opening delimiter.`,
				};
			}

			const last = stack.pop();
			if (!last) {
				return {
					valid: false,
					error: `Unexpected closing '${char}' with no matching opening delimiter.`,
				};
			}
			const matchPair =
				(last.char === '{' && char === '}') ||
				(last.char === '(' && char === ')') ||
				(last.char === '[' && char === ']');

			if (!matchPair) {
				return {
					valid: false,
					error: `Mismatched delimiters: opened '${last.char}' but closed with '${char}'.`,
				};
			}
		}
	}

	if (stack.length > 0) {
		const unclosed = stack.map(s => `'${s.char}'`).join(', ');
		return {
			valid: false,
			error: `Unclosed delimiter(s): ${unclosed}.`,
		};
	}

	if (inSingleQuote || inDoubleQuote || inTemplateLiteral) {
		return {
			valid: false,
			error: 'Unclosed string literal or template string.',
		};
	}

	return {valid: true};
}

/**
 * Normalizes replacement body: if the model wrapped the body in outer `{ ... }`, unwrap it.
 */
function normalizeReplacementBody(rawBody: string): string {
	const trimmed = rawBody.trim();
	if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
		// Verify if the outer { } wraps the entire body
		const inner = trimmed.slice(1, -1);
		const balance = validateDelimiterBalance(inner);
		if (balance.valid) {
			return inner;
		}
	}
	return rawBody;
}

/**
 * Deterministically splices a new body into a syntax island while byte-locking all outer content.
 */
export function spliceSyntaxIsland(
	originalContent: string,
	island: SyntaxIsland,
	newBody: string,
): IslandSplicingResult {
	const normalizedBody = normalizeReplacementBody(newBody);

	// Validate delimiter balance of the replacement
	const bodyValidation = validateDelimiterBalance(normalizedBody);
	if (!bodyValidation.valid) {
		return {
			success: false,
			error: `Invalid syntax in replacement body: ${bodyValidation.error}`,
			island,
		};
	}

	const prefix = originalContent.slice(0, island.bodyStartOffset);
	const suffix = originalContent.slice(island.bodyEndOffset);

	// Ensure clean spacing/indentation if body doesn't start with newline
	let formattedBody = normalizedBody;
	if (!formattedBody.startsWith('\n') && !prefix.endsWith('\n')) {
		formattedBody = `\n${formattedBody}\n`;
	} else if (!formattedBody.endsWith('\n') && !suffix.startsWith('\n')) {
		formattedBody = `${formattedBody}\n`;
	}

	const newContent = prefix + formattedBody + suffix;

	// Verify whole reconstructed file delimiter integrity
	const wholeValidation = validateDelimiterBalance(newContent);
	if (!wholeValidation.valid) {
		return {
			success: false,
			error: `Reconstructed file failed syntax validation: ${wholeValidation.error}`,
			island,
		};
	}

	return {
		success: true,
		newContent,
		island,
	};
}
