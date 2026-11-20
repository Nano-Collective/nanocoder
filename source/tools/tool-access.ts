/**
 * Per-run tool access filter, driven by `--allowed-tools` / `--disallowed-tools`.
 *
 * The filter is a process-wide singleton rather than a parameter because it
 * has to reach every place a tool list is resolved for one run: the TUI and
 * plain chat loops, prompt building, `/usage`, ACP conversations layered over
 * the same process, and delegated subagents. `ToolManager` and the subagent
 * executor both read it, so "this run may only use read tools" cannot be
 * bypassed by asking a subagent to do the work.
 *
 * Matching is exact names plus simple `*` globs (`search_*`, `mcp_*`). Deny
 * wins over allow.
 */

export interface RunToolAccess {
	/** When non-empty, only names matching one of these patterns are offered. */
	allowed: readonly string[];
	/** Names matching one of these patterns are always removed. */
	disallowed: readonly string[];
}

export type ToolAccessFlag = '--allowed-tools' | '--disallowed-tools';

export interface ParsedToolAccess {
	allowed: string[];
	disallowed: string[];
}

const FLAGS: readonly ToolAccessFlag[] = [
	'--allowed-tools',
	'--disallowed-tools',
];

let runToolAccess: RunToolAccess | undefined;

function isToolAccessFlag(value: string): value is ToolAccessFlag {
	return (FLAGS as readonly string[]).includes(value);
}

/**
 * Match one tool name against a pattern. A pattern without `*` is an exact
 * name; `*` stands for any run of characters. Names are case-sensitive,
 * because tool names are.
 *
 * Hand-rolled rather than a RegExp: a pattern of repeated `*a` segments makes
 * a backtracking engine take minutes on a long name, and this runs over every
 * tool name on every tool-list build. The greedy scan remembers only the last
 * `*` it saw, so there is nothing to backtrack into. Every character other
 * than `*` is literal - `?` and `{a,b}` are not special here.
 */
export function matchesToolPattern(name: string, pattern: string): boolean {
	let nameIndex = 0;
	let patternIndex = 0;
	// Pattern index of the last `*`, and the name index to resume from when the
	// current guess fails.
	let starIndex = -1;
	let resumeNameIndex = 0;

	while (nameIndex < name.length) {
		if (patternIndex < pattern.length && pattern[patternIndex] === '*') {
			starIndex = patternIndex;
			resumeNameIndex = nameIndex;
			patternIndex++;
		} else if (
			patternIndex < pattern.length &&
			pattern[patternIndex] === name[nameIndex]
		) {
			nameIndex++;
			patternIndex++;
		} else if (starIndex !== -1) {
			// Let the last `*` swallow one more character and retry.
			patternIndex = starIndex + 1;
			resumeNameIndex++;
			nameIndex = resumeNameIndex;
		} else {
			return false;
		}
	}

	// Trailing `*`s may match nothing.
	while (patternIndex < pattern.length && pattern[patternIndex] === '*') {
		patternIndex++;
	}
	return patternIndex === pattern.length;
}

export function matchesAnyToolPattern(
	name: string,
	patterns: readonly string[],
): boolean {
	return patterns.some(pattern => matchesToolPattern(name, pattern));
}

/** Install this run's filter. Empty lists (or undefined) clear it. */
export function setRunToolAccess(access: RunToolAccess | undefined): void {
	if (
		!access ||
		(access.allowed.length === 0 && access.disallowed.length === 0)
	) {
		runToolAccess = undefined;
		return;
	}
	runToolAccess = {
		allowed: [...access.allowed],
		disallowed: [...access.disallowed],
	};
}

export function getRunToolAccess(): RunToolAccess | undefined {
	return runToolAccess;
}

export function hasRunToolAccess(): boolean {
	return runToolAccess !== undefined;
}

/** Test seam: drop the filter between cases. */
export function resetRunToolAccess(): void {
	runToolAccess = undefined;
}

/**
 * Apply the filter to a list of tool names: the allow-list intersects first,
 * then the deny-list removes, so deny always wins.
 */
export function filterToolNamesByAccess(
	names: readonly string[],
	access: RunToolAccess | undefined = runToolAccess,
): string[] {
	if (!access) return [...names];

	let result = [...names];
	if (access.allowed.length > 0) {
		result = result.filter(name => matchesAnyToolPattern(name, access.allowed));
	}
	if (access.disallowed.length > 0) {
		result = result.filter(
			name => !matchesAnyToolPattern(name, access.disallowed),
		);
	}
	return result;
}

/** Patterns that match none of the supplied names. */
export function findUnmatchedToolPatterns(
	patterns: readonly string[],
	knownNames: readonly string[],
): string[] {
	return patterns.filter(
		pattern => !knownNames.some(name => matchesToolPattern(name, pattern)),
	);
}

function quoteAll(values: readonly string[]): string {
	return values.map(value => JSON.stringify(value)).join(', ');
}

function unknownPatternsMessage(
	flag: ToolAccessFlag,
	unmatched: readonly string[],
): string {
	return `Unknown tool ${unmatched.length === 1 ? 'name' : 'names'} in ${flag}: ${quoteAll(unmatched)}.`;
}

/**
 * Validate the installed filter against every tool name this run knows.
 * Returns a message naming the unknown patterns and the valid tools, or
 * undefined when everything resolves. Call this after custom, skill and MCP
 * tools are registered, so an MCP or custom name is not reported as a typo.
 */
export function validateRunToolAccess(
	knownNames: readonly string[],
): string | undefined {
	const access = runToolAccess;
	if (!access) return undefined;

	const problems: string[] = [];
	const unmatchedAllowed = findUnmatchedToolPatterns(
		access.allowed,
		knownNames,
	);
	if (unmatchedAllowed.length > 0) {
		problems.push(unknownPatternsMessage('--allowed-tools', unmatchedAllowed));
	}
	const unmatchedDisallowed = findUnmatchedToolPatterns(
		access.disallowed,
		knownNames,
	);
	if (unmatchedDisallowed.length > 0) {
		problems.push(
			unknownPatternsMessage('--disallowed-tools', unmatchedDisallowed),
		);
	}
	if (problems.length === 0) return undefined;

	const known = [...new Set(knownNames)].sort();
	return `${problems.join(' ')} Valid tools: ${known.join(', ')}. Patterns may use * as a wildcard.`;
}

/** One-line description for `/status`, the run summary and the plain shell. */
export function formatToolAccessSummary(access: RunToolAccess): string {
	if (access.allowed.length > 0) {
		const blocked =
			access.disallowed.length > 0
				? ` (blocked: ${access.disallowed.join(', ')})`
				: '';
		return `only ${access.allowed.join(', ')}${blocked}`;
	}
	return `all except ${access.disallowed.join(', ')}`;
}

function splitToolPatterns(value: string): string[] {
	return value
		.split(',')
		.map(part => part.trim())
		.filter(part => part.length > 0);
}

function dedupe(values: readonly string[]): string[] {
	return [...new Set(values)];
}

/**
 * Read `--allowed-tools` / `--disallowed-tools` from argv. Both the spaced
 * (`--flag a,b`) and fused (`--flag=a,b`) forms are accepted, the flag may
 * appear more than once, and values are comma-separated.
 */
export function parseToolAccessArgs(
	args: readonly string[],
): ParsedToolAccess | {error: string} {
	const allowed: string[] = [];
	const disallowed: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		let flag: ToolAccessFlag | undefined;
		let rawValue: string | undefined;

		const equalsIndex = arg.indexOf('=');
		const name = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
		if (!isToolAccessFlag(name)) continue;
		flag = name;

		if (equalsIndex !== -1) {
			rawValue = arg.slice(equalsIndex + 1);
		} else {
			const next = args[i + 1];
			if (next === undefined || next.startsWith('-')) {
				return {
					error: `${flag} requires a value: a comma-separated list of tool names. Patterns may use * as a wildcard.`,
				};
			}
			rawValue = next;
			i++;
		}

		const patterns = splitToolPatterns(rawValue);
		if (patterns.length === 0) {
			return {
				error: `${flag} requires at least one tool name. Patterns may use * as a wildcard.`,
			};
		}
		(flag === '--allowed-tools' ? allowed : disallowed).push(...patterns);
	}

	return {allowed: dedupe(allowed), disallowed: dedupe(disallowed)};
}
