import {LRUCache} from 'lru-cache';

/**
 * Glob matching shared by file discovery (utils/fs/file-search) and event,
 * formatter and lifecycle-hook filters (events/event-router). Patterns are
 * brace-expanded, tokenised, and matched with a dynamic-programming table
 * rather than a compiled regex, so no pattern can make matching backtrack.
 */

/** Longest pattern accepted; longer ones throw. */
export const MAX_GLOB_PATTERN_LENGTH = 1000;

const MAX_BRACE_EXPANSIONS = 64;

function expandBraces(pattern: string): string[] {
	let combinationCount = 0;

	const expand = (current: string): string[] => {
		const match = current.match(/\{([^{}]+)\}/);
		if (!match || match.index === undefined) {
			combinationCount++;
			if (combinationCount > MAX_BRACE_EXPANSIONS) {
				throw new Error(
					`Glob pattern has too many brace-expansion combinations (max ${MAX_BRACE_EXPANSIONS}).`,
				);
			}
			return [current];
		}

		const before = current.slice(0, match.index);
		const after = current.slice(match.index + match[0].length);

		return match[1]
			.split(',')
			.flatMap(part => expand(`${before}${part.trim()}${after}`));
	};

	return expand(pattern);
}

type GlobToken =
	| {type: 'literal'; char: string}
	| {type: 'slash'}
	| {type: 'qmark'}
	| {type: 'star'}
	| {type: 'globstar'}
	| {type: 'globstarSlash'};

function tokenizeGlob(pattern: string): GlobToken[] {
	const tokens: GlobToken[] = [];
	let index = 0;
	while (index < pattern.length) {
		const char = pattern[index];
		if (char === '*') {
			if (pattern[index + 1] === '*') {
				if (pattern[index + 2] === '/') {
					tokens.push({type: 'globstarSlash'});
					index += 3;
				} else {
					tokens.push({type: 'globstar'});
					index += 2;
				}
			} else {
				tokens.push({type: 'star'});
				index += 1;
			}
			continue;
		}
		if (char === '?') {
			tokens.push({type: 'qmark'});
			index += 1;
			continue;
		}
		if (char === '/') {
			tokens.push({type: 'slash'});
			index += 1;
			continue;
		}
		tokens.push({type: 'literal', char});
		index += 1;
	}
	return tokens;
}

// DP table, not a compiled regex - no backtracking, so no ReDoS.
function matchTokens(text: string, tokens: GlobToken[]): boolean {
	const textLength = text.length;
	const tokenCount = tokens.length;

	let previousRow = new Array<boolean>(tokenCount + 1).fill(false);
	previousRow[0] = true;
	for (let tokenIndex = 1; tokenIndex <= tokenCount; tokenIndex++) {
		const token = tokens[tokenIndex - 1];
		previousRow[tokenIndex] =
			(token.type === 'star' ||
				token.type === 'globstar' ||
				token.type === 'globstarSlash') &&
			previousRow[tokenIndex - 1];
	}

	// True once any row hits this column - globstarSlash can start from any earlier row.
	const columnEverTrue = [...previousRow];

	for (let textIndex = 1; textIndex <= textLength; textIndex++) {
		const currentRow = new Array<boolean>(tokenCount + 1).fill(false);
		const textChar = text[textIndex - 1];

		for (let tokenIndex = 1; tokenIndex <= tokenCount; tokenIndex++) {
			const token = tokens[tokenIndex - 1];
			let matched: boolean;
			switch (token.type) {
				case 'literal':
					matched = previousRow[tokenIndex - 1] && textChar === token.char;
					break;
				case 'slash':
					matched = previousRow[tokenIndex - 1] && textChar === '/';
					break;
				case 'qmark':
					matched = previousRow[tokenIndex - 1] && textChar !== '/';
					break;
				case 'star':
					matched =
						currentRow[tokenIndex - 1] ||
						(previousRow[tokenIndex] && textChar !== '/');
					break;
				case 'globstar':
					matched = currentRow[tokenIndex - 1] || previousRow[tokenIndex];
					break;
				case 'globstarSlash':
					matched =
						currentRow[tokenIndex - 1] ||
						(textChar === '/' && columnEverTrue[tokenIndex - 1]);
					break;
			}
			currentRow[tokenIndex] = matched;
		}

		previousRow = currentRow;
		for (let tokenIndex = 0; tokenIndex <= tokenCount; tokenIndex++) {
			columnEverTrue[tokenIndex] =
				columnEverTrue[tokenIndex] || currentRow[tokenIndex];
		}
	}

	return previousRow[tokenCount];
}

// Bounds total tokens, not entry count - one entry can hold up to MAX_BRACE_EXPANSIONS arrays.
/** @internal Exported for direct unit testing only. */
export const GLOB_TOKEN_CACHE_MAX_TOKENS = 1_000_000;

/** @internal Exported for direct unit testing only. */
export const globTokenCache = new LRUCache<string, GlobToken[][]>({
	maxSize: GLOB_TOKEN_CACHE_MAX_TOKENS,
	sizeCalculation: tokenized =>
		tokenized.reduce((sum, tokens) => sum + tokens.length, 0),
});

function compileGlob(pattern: string): GlobToken[][] {
	const cached = globTokenCache.get(pattern);
	if (cached) {
		return cached;
	}

	if (pattern.length > MAX_GLOB_PATTERN_LENGTH) {
		throw new Error(
			`Glob pattern is too long (${pattern.length} chars, max ${MAX_GLOB_PATTERN_LENGTH}).`,
		);
	}

	const tokenized = expandBraces(pattern).map(tokenizeGlob);

	globTokenCache.set(pattern, tokenized);
	return tokenized;
}

/**
 * Whether `text` matches the glob `pattern`. Both must already use `/` as
 * the separator; callers normalise paths their own way first.
 *
 * - `*` matches within one path segment, `?` one character other than `/`
 * - `**` matches anything, including `/`; `**` followed by `/` matches
 *   zero or more whole directories
 * - `{a,b}` alternation, nested or sequential, up to MAX_BRACE_EXPANSIONS
 *   combinations; whitespace around each alternative is trimmed
 * - everything else is literal; there is no `[...]` class or `!` negation
 *
 * Throws when the pattern is longer than MAX_GLOB_PATTERN_LENGTH or expands
 * to too many combinations.
 */
export function globMatches(text: string, pattern: string): boolean {
	return compileGlob(pattern).some(tokens => matchTokens(text, tokens));
}
