import type {
	IslandExtractionResult,
	SyntaxIsland,
	SyntaxIslandKind,
} from '@/types/syntax-island';

/**
 * Finds the index of the matching closing brace for an opening brace at `openIndex`.
 * Safely skips string literals (single, double, template) and comments (line, block).
 */
export function findMatchingBrace(code: string, openIndex: number): number {
	let depth = 0;
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let inTemplateLiteral = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = openIndex; i < code.length; i++) {
		const char = code[i];
		const nextChar = code[i + 1];
		const prevChar = i > 0 ? code[i - 1] : '';

		// Handle comments
		if (inLineComment) {
			if (char === '\n') {
				inLineComment = false;
			}
			continue;
		}

		if (inBlockComment) {
			if (char === '*' && nextChar === '/') {
				inBlockComment = false;
				i++; // Skip '/'
			}
			continue;
		}

		// Handle strings
		if (inSingleQuote) {
			if (char === "'" && prevChar !== '\\') {
				inSingleQuote = false;
			}
			continue;
		}

		if (inDoubleQuote) {
			if (char === '"' && prevChar !== '\\') {
				inDoubleQuote = false;
			}
			continue;
		}

		if (inTemplateLiteral) {
			if (char === '`' && prevChar !== '\\') {
				inTemplateLiteral = false;
			}
			continue;
		}

		// Check start of comments or strings
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

		// Brace depth tracking
		if (char === '{') {
			depth++;
		} else if (char === '}') {
			depth--;
			if (depth === 0) {
				return i;
			}
		}
	}

	return -1;
}

/**
 * Escapes regex special characters.
 */
function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Locates a syntax island (function, method, component, arrow function, class) by symbol name.
 */
export function findSyntaxIsland(
	content: string,
	symbolName: string,
): IslandExtractionResult {
	if (!symbolName || !symbolName.trim()) {
		return {found: false, error: 'Symbol name cannot be empty.'};
	}

	const trimmedName = symbolName.trim();
	const escapedName = escapeRegex(trimmedName);

	// Patterns to find start of target symbol
	const patterns: Array<{regex: RegExp; kind: SyntaxIslandKind}> = [
		// standard function: function name(...) { ... } or export async function name(...)
		{
			regex: new RegExp(
				`(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s*\\*?\\s+${escapedName}\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)[^{]*\\{`,
				'g',
			),
			kind: 'function',
		},
		// arrow function or expression: const name = async (...) => { ... }
		{
			regex: new RegExp(
				`(?:export\\s+)?(?:const|let|var)\\s+${escapedName}\\s*(?::\\s*[^=]+)?\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[a-zA-Z0-9_$]+)\\s*(?::\\s*[^=]+)?\\s*=>\\s*\\{`,
				'g',
			),
			kind: 'arrow',
		},
		// class method: async name(...) { ... } or name(...) { ... }
		{
			regex: new RegExp(
				`(?:(?:public|private|protected|static|async|readonly|override|get|set)\\s+)*${escapedName}\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)[^{]*\\{`,
				'g',
			),
			kind: 'method',
		},
		// class definition: class name { ... }
		{
			regex: new RegExp(
				`(?:export\\s+(?:default\\s+)?)?(?:abstract\\s+)?class\\s+${escapedName}[^{]*\\{`,
				'g',
			),
			kind: 'class',
		},
	];

	for (const {regex, kind} of patterns) {
		regex.lastIndex = 0;
		const match = regex.exec(content);
		if (match) {
			const startOffset = match.index;
			const openBraceOffset = match.index + match[0].length - 1;

			if (content[openBraceOffset] === '{') {
				const closeBraceOffset = findMatchingBrace(content, openBraceOffset);
				if (closeBraceOffset !== -1) {
					const bodyStartOffset = openBraceOffset + 1;
					const bodyEndOffset = closeBraceOffset;
					const endOffset = closeBraceOffset + 1;

					const startLine = content.slice(0, startOffset).split('\n').length;
					const endLine = content.slice(0, endOffset).split('\n').length;

					const signature = content.slice(startOffset, openBraceOffset).trim();
					const originalBody = content.slice(bodyStartOffset, bodyEndOffset);
					const fullContent = content.slice(startOffset, endOffset);

					const island: SyntaxIsland = {
						name: trimmedName,
						kind,
						startOffset,
						endOffset,
						bodyStartOffset,
						bodyEndOffset,
						startLine,
						endLine,
						signature,
						originalBody,
						fullContent,
					};

					return {
						found: true,
						island,
					};
				}
			}
		}
	}

	return {
		found: false,
		error: `Syntax island symbol '${trimmedName}' was not found in the file.`,
	};
}
