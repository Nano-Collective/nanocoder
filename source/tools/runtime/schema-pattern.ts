/**
 * A bounded matcher for the common, non-recursive subset of JSON Schema
 * regular expressions. Schemas can come from CLI arguments or files, so do not
 * pass schema patterns to JavaScript's backtracking RegExp engine: a
 * catastrophically backtracking expression could block the CLI indefinitely.
 *
 * Supported: literals, `.`, `\d`/`\w`/`\s` (and their uppercase negations),
 * character classes and ranges, `^`/`$`, and `*`/`+`/`?`/`{m,n}` quantifiers.
 * Groups, alternation, lookarounds, Unicode property escapes, and other
 * constructs are reported as unsupported by the document validator.
 */

type CharacterMatcher = (character: string) => boolean;

interface PatternToken {
	matches: CharacterMatcher;
	minimum: number;
	maximum: number;
}

type ParseResult =
	| {
			supported: true;
			tokens: PatternToken[];
			anchoredStart: boolean;
			anchoredEnd: boolean;
	  }
	| {supported: false; reason: string};

const MAX_PATTERN_LENGTH = 256;
const MAX_QUANTIFIER = 1000;
const MAX_PATTERN_WORK = 20_000_000;

function isEscaped(pattern: string, index: number): boolean {
	let slashes = 0;
	for (
		let cursor = index - 1;
		cursor >= 0 && pattern[cursor] === '\\';
		cursor--
	) {
		slashes++;
	}
	return slashes % 2 === 1;
}

function isDigit(character: string | undefined): boolean {
	return character !== undefined && character >= '0' && character <= '9';
}

function isWord(character: string): boolean {
	return (
		(character >= 'a' && character <= 'z') ||
		(character >= 'A' && character <= 'Z') ||
		(character >= '0' && character <= '9') ||
		character === '_'
	);
}

function isWhitespace(character: string): boolean {
	return (
		character === ' ' ||
		character === '\t' ||
		character === '\n' ||
		character === '\r' ||
		character === '\f' ||
		character === '\v'
	);
}

function escapedMatcher(character: string): CharacterMatcher | undefined {
	switch (character) {
		case 'd':
			return c => isDigit(c);
		case 'D':
			return c => !isDigit(c);
		case 'w':
			return isWord;
		case 'W':
			return c => !isWord(c);
		case 's':
			return isWhitespace;
		case 'S':
			return c => !isWhitespace(c);
		default:
			return undefined;
	}
}

function parsePattern(pattern: string): ParseResult {
	if (pattern.length > MAX_PATTERN_LENGTH) {
		return {
			supported: false,
			reason: `pattern exceeds the ${MAX_PATTERN_LENGTH}-character safety limit`,
		};
	}

	let index = 0;
	const anchoredStart = pattern.startsWith('^');
	const anchoredEnd =
		pattern.endsWith('$') && !isEscaped(pattern, pattern.length - 1);
	if (anchoredStart) index++;
	const end = pattern.length - (anchoredEnd ? 1 : 0);
	const tokens: PatternToken[] = [];

	while (index < end) {
		const character = pattern[index++];
		let matcher: CharacterMatcher;

		if (character === '.') {
			matcher = c =>
				c !== '\n' && c !== '\r' && c !== '\u2028' && c !== '\u2029';
		} else if (character === '[') {
			let negate = false;
			if (pattern[index] === '^') {
				negate = true;
				index++;
			}
			const singles = new Set<string>();
			const ranges: Array<[string, string]> = [];
			let closed = false;
			while (index < end) {
				let first = pattern[index++];
				if (first === ']') {
					if (singles.size === 0 && ranges.length === 0) {
						singles.add(']');
						continue;
					}
					closed = true;
					break;
				}
				if (first === '\\') {
					const escaped = pattern[index++];
					if (escaped === undefined) break;
					const category = escapedMatcher(escaped);
					if (category) {
						return {
							supported: false,
							reason:
								'character-class shorthand escapes are not supported inside classes',
						};
					}
					first = escaped;
				}

				if (
					pattern[index] === '-' &&
					index + 1 < end &&
					pattern[index + 1] !== ']'
				) {
					index++;
					let last = pattern[index++];
					if (last === '\\') last = pattern[index++];
					if (last === undefined || first > last) {
						return {supported: false, reason: 'invalid character-class range'};
					}
					ranges.push([first, last]);
				} else {
					singles.add(first);
				}
			}
			if (!closed) {
				return {supported: false, reason: 'unterminated character class'};
			}
			matcher = value => {
				const included =
					singles.has(value) ||
					ranges.some(([from, to]) => value >= from && value <= to);
				return negate ? !included : included;
			};
		} else if (character === '\\') {
			const escaped = pattern[index++];
			if (escaped === undefined) {
				return {supported: false, reason: 'trailing escape'};
			}
			const category = escapedMatcher(escaped);
			if (category) {
				matcher = category;
			} else if ('\\^$.*+?()[]{}|/-'.includes(escaped)) {
				matcher = value => value === escaped;
			} else {
				return {
					supported: false,
					reason: `escape "\\${escaped}" is outside the supported safe subset`,
				};
			}
		} else if ('^$*+?{}()|'.includes(character)) {
			return {
				supported: false,
				reason: `regex construct "${character}" is outside the supported safe subset`,
			};
		} else {
			matcher = value => value === character;
		}

		let minimum = 1;
		let maximum = 1;
		const quantifier = pattern[index];
		if (quantifier === '*') {
			minimum = 0;
			maximum = Number.POSITIVE_INFINITY;
			index++;
		} else if (quantifier === '+') {
			minimum = 1;
			maximum = Number.POSITIVE_INFINITY;
			index++;
		} else if (quantifier === '?') {
			minimum = 0;
			maximum = 1;
			index++;
		} else if (quantifier === '{') {
			index++;
			const minStart = index;
			while (isDigit(pattern[index])) index++;
			if (minStart === index) {
				return {supported: false, reason: 'invalid bounded quantifier'};
			}
			minimum = Number(pattern.slice(minStart, index));
			maximum = minimum;
			if (pattern[index] === ',') {
				index++;
				const maxStart = index;
				while (isDigit(pattern[index])) index++;
				maximum =
					maxStart === index
						? Number.POSITIVE_INFINITY
						: Number(pattern.slice(maxStart, index));
			}
			if (pattern[index] !== '}') {
				return {supported: false, reason: 'invalid bounded quantifier'};
			}
			index++;
			if (
				minimum > MAX_QUANTIFIER ||
				(maximum !== Number.POSITIVE_INFINITY && maximum > MAX_QUANTIFIER) ||
				maximum < minimum
			) {
				return {
					supported: false,
					reason: `quantifier exceeds the ${MAX_QUANTIFIER}-character safety limit`,
				};
			}
		}
		tokens.push({matches: matcher, minimum, maximum});
	}

	return {supported: true, tokens, anchoredStart, anchoredEnd};
}

/** Match a JSON Schema pattern with predictable O(pattern × input) work. */
export function matchSchemaPattern(
	value: string,
	pattern: string,
): {supported: true; matched: boolean} | {supported: false; reason: string} {
	const parsed = parsePattern(pattern);
	if (!parsed.supported) return parsed;

	const characters = value.split('');
	const length = characters.length;
	if (length * parsed.tokens.length > MAX_PATTERN_WORK) {
		return {
			supported: false,
			reason: 'pattern matching exceeds the validation work limit',
		};
	}
	let reachable = new Array<boolean>(length + 1).fill(false);
	if (parsed.anchoredStart) {
		reachable[0] = true;
	} else {
		// JSON Schema patterns search for a match anywhere in the string.
		reachable.fill(true);
	}

	for (const token of parsed.tokens) {
		const prefix = new Array<number>(length + 2).fill(0);
		for (let position = 0; position <= length; position++) {
			prefix[position + 1] = prefix[position] + Number(reachable[position]);
		}

		const next = new Array<boolean>(length + 1).fill(false);
		let matchingRun = 0;
		for (let end = 0; end <= length; end++) {
			if (end > 0 && token.matches(characters[end - 1])) {
				matchingRun++;
			} else {
				matchingRun = 0;
			}

			const maxLength = Math.min(token.maximum, matchingRun);
			if (maxLength < token.minimum) continue;
			const firstStart = end - maxLength;
			const lastStart = end - token.minimum;
			if (prefix[lastStart + 1] > prefix[firstStart]) next[end] = true;
		}
		reachable = next;
	}

	return {
		supported: true,
		matched: parsed.anchoredEnd ? reachable[length] : reachable.some(Boolean),
	};
}
