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
 * Finds all character ranges that represent comments (line, block) or string literals (single, double, template).
 */
function getIgnoredRanges(code: string): Array<{start: number; end: number}> {
	const ranges: Array<{start: number; end: number}> = [];
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let inTemplateLiteral = false;
	let inLineComment = false;
	let inBlockComment = false;
	let start = -1;

	for (let i = 0; i < code.length; i++) {
		const char = code[i];
		const nextChar = code[i + 1];
		const prevChar = i > 0 ? code[i - 1] : '';

		if (inLineComment) {
			if (char === '\n') {
				ranges.push({start, end: i});
				inLineComment = false;
			}
			continue;
		}

		if (inBlockComment) {
			if (char === '*' && nextChar === '/') {
				ranges.push({start, end: i + 2});
				inBlockComment = false;
				i++;
			}
			continue;
		}

		if (inSingleQuote) {
			if (char === "'" && prevChar !== '\\') {
				ranges.push({start, end: i + 1});
				inSingleQuote = false;
			}
			continue;
		}

		if (inDoubleQuote) {
			if (char === '"' && prevChar !== '\\') {
				ranges.push({start, end: i + 1});
				inDoubleQuote = false;
			}
			continue;
		}

		if (inTemplateLiteral) {
			if (char === '`' && prevChar !== '\\') {
				ranges.push({start, end: i + 1});
				inTemplateLiteral = false;
			}
			continue;
		}

		if (char === '/' && nextChar === '/') {
			inLineComment = true;
			start = i;
			i++;
			continue;
		}

		if (char === '/' && nextChar === '*') {
			inBlockComment = true;
			start = i;
			i++;
			continue;
		}

		if (char === "'") {
			inSingleQuote = true;
			start = i;
			continue;
		}

		if (char === '"') {
			inDoubleQuote = true;
			start = i;
			continue;
		}

		if (char === '`') {
			inTemplateLiteral = true;
			start = i;
			continue;
		}
	}

	if (
		inLineComment ||
		inBlockComment ||
		inSingleQuote ||
		inDoubleQuote ||
		inTemplateLiteral
	) {
		ranges.push({start, end: code.length});
	}

	return ranges;
}

function isOffsetIgnored(
	ranges: Array<{start: number; end: number}>,
	offset: number,
): boolean {
	return ranges.some(r => offset >= r.start && offset < r.end);
}

const INVALID_PRECEDING_KEYWORDS = new Set([
	'if',
	'while',
	'for',
	'catch',
	'switch',
	'with',
	'else',
	'return',
	'throw',
	'yield',
	'await',
	'new',
	'typeof',
	'instanceof',
	'case',
	'delete',
	'void',
	'const',
	'let',
	'var',
	'function',
	'import',
	'from',
	'export',
	'type',
	'interface',
]);

/**
 * Escapes regex special characters.
 */
function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface PatternEntry {
	regex: RegExp;
	kind: SyntaxIslandKind;
	validateMatch?: (content: string, matchIndex: number) => boolean;
}

/**
 * Locates a syntax island (function, method, arrow function, class) by symbol name.
 */
export function findSyntaxIsland(
	content: string,
	symbolName: string,
): IslandExtractionResult {
	if (!symbolName || !symbolName.trim()) {
		return {found: false, error: 'Symbol name cannot be empty.'};
	}

	const trimmedName = symbolName.trim();
	if (trimmedName.length > 256) {
		return {
			found: false,
			error: 'Symbol name is too long (maximum 256 characters).',
		};
	}

	const escapedName = escapeRegex(trimmedName);
	const ignoredRanges = getIgnoredRanges(content);

	// Patterns to find start of target symbol
	// Note: escapedName is sanitized via escapeRegex() and length-bounded; threat model is developer tool input.
	const patterns: PatternEntry[] = [
		// standard function: function name(...) { ... } or export async function name(...)
		{
			// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
			regex: new RegExp(
				`(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s*\\*?\\s+${escapedName}\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)[^{]*\\{`,
				'g',
			),
			kind: 'function',
		},
		// arrow function or expression: const name = async (...) => { ... }
		{
			// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
			regex: new RegExp(
				`(?:export\\s+)?(?:const|let|var)\\s+${escapedName}\\s*(?::\\s*[^=]+)?\\s*=\\s*(?:async\\s*)?(?:<[^>]*>\\s*)?(?:\\([^)]*\\)|[a-zA-Z0-9_$]+)\\s*(?::\\s*[^=]+)?\\s*=>\\s*\\{`,
				'g',
			),
			kind: 'arrow',
		},
		// class method with explicit modifiers (e.g. public async calculate(...) { ... })
		{
			// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
			regex: new RegExp(
				`(?:(?:public|private|protected|static|async|readonly|override|get|set)\\s+)+${escapedName}\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)[^{]*\\{`,
				'g',
			),
			kind: 'method',
		},
		// class/object method without explicit modifiers (e.g. calculate(...) { ... })
		{
			// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
			regex: new RegExp(
				`\\b${escapedName}\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)[^{]*\\{`,
				'g',
			),
			kind: 'method',
			validateMatch: (source: string, matchIndex: number): boolean => {
				const before = source
					.slice(Math.max(0, matchIndex - 60), matchIndex)
					.trimEnd();
				if (!before) return true;
				const lastChar = before[before.length - 1];
				if (
					['(', '.', '=', '+', '-', '*', '/', ',', '?', '!', '&', '|'].includes(
						lastChar,
					)
				) {
					return false;
				}
				const matchWord = before.match(/([a-zA-Z0-9_$]+)$/);
				if (matchWord) {
					const word = matchWord[1];
					if (INVALID_PRECEDING_KEYWORDS.has(word)) {
						return false;
					}
				}
				return true;
			},
		},
		// class definition: class name { ... } or class name<T> extends Base implements IFoo { ... }
		{
			// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
			regex: new RegExp(
				`(?:export\\s+(?:default\\s+)?)?(?:abstract\\s+)?class\\s+${escapedName}(?:<[^{]*>)?(?:\\s+extends\\s+[^{]+)?(?:\\s+implements\\s+[^{]+)?\\s*\\{`,
				'g',
			),
			kind: 'class',
		},
	];

	for (const {regex, kind, validateMatch} of patterns) {
		regex.lastIndex = 0;
		let match: RegExpExecArray | null = null;

		while (true) {
			match = regex.exec(content);
			if (!match) break;

			const startOffset = match.index;

			// Skip if this match is inside a comment or string literal
			if (isOffsetIgnored(ignoredRanges, startOffset)) {
				continue;
			}

			// Validate match context (e.g. not a call site inside control flow)
			if (validateMatch && !validateMatch(content, startOffset)) {
				continue;
			}

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
