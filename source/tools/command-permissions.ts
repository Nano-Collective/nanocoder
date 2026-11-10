import type {PermissionsConfig} from '@/types/config';

/**
 * One parsed entry from `nanocoder.permissions.allow` / `.deny`.
 *
 * A rule is either a bare tool name (`execute_bash`) or a tool name with a
 * command pattern (`execute_bash(git status)`). `source` keeps the original
 * text so a denial can quote the rule the user wrote.
 */
interface PermissionRule {
	tool: string;
	pattern?: string;
	source: string;
}

export interface PermissionRuleDecision {
	/** True when an allow rule covers the whole call and no deny rule matched. */
	allowed: boolean;
	/** Set when a deny rule matched; safe to show to the user and the model. */
	deniedReason?: string;
}

/**
 * Parse a single permission rule. Returns null for anything malformed so a
 * typo in the config is ignored rather than applied with the wrong meaning.
 */
export function parsePermissionRule(
	rule: string,
): {tool: string; pattern?: string} | null {
	const trimmed = rule.trim();
	if (trimmed === '') return null;

	const open = trimmed.indexOf('(');
	if (open === -1) {
		return trimmed.includes(')') ? null : {tool: trimmed};
	}

	if (!trimmed.endsWith(')')) return null;
	const tool = trimmed.slice(0, open).trim();
	const pattern = trimmed.slice(open + 1, -1).trim();
	if (tool === '' || pattern === '') return null;
	return {tool, pattern};
}

/**
 * Match a whole simple command against a pattern. `*` matches any sequence of
 * characters; every other character is literal, so a command containing
 * regex metacharacters (`git log --grep='a.b'`) is matched exactly.
 */
export function matchesCommandPattern(
	pattern: string,
	command: string,
): boolean {
	// Iterative glob match with backtracking only to the last star. This keeps
	// the rule text literal (no RegExp built from config) and avoids ReDoS from
	// nested quantifiers.
	let patternIndex = 0;
	let commandIndex = 0;
	let lastStar = -1;
	let starMatch = 0;

	while (commandIndex < command.length) {
		if (
			patternIndex < pattern.length &&
			pattern[patternIndex] === command[commandIndex]
		) {
			patternIndex++;
			commandIndex++;
			continue;
		}
		if (patternIndex < pattern.length && pattern[patternIndex] === '*') {
			lastStar = patternIndex++;
			starMatch = commandIndex;
			continue;
		}
		if (lastStar !== -1) {
			patternIndex = lastStar + 1;
			commandIndex = ++starMatch;
			continue;
		}
		return false;
	}

	while (patternIndex < pattern.length && pattern[patternIndex] === '*') {
		patternIndex++;
	}
	return patternIndex === pattern.length;
}

/**
 * Split a command line into the simple commands it will run, or return null
 * when that cannot be done safely.
 *
 * Allow rules are matched per simple command: `git status && rm -rf x` must
 * not be covered by an allow rule for `git status`. Splitting understands
 * quotes, escapes, `;`, newlines, `&&`, `||` and `|`. Subshells, command
 * substitution, process substitution, redirections, brace/group syntax and
 * background jobs return null, because a wildcard could otherwise cover a
 * nested command the splitter never saw.
 */
export function splitSimpleCommands(command: string): string[] | null {
	// A backslash-newline is a line continuation, not a command separator. The
	// shell removes it entirely, so removing it here matches what will run.
	const normalized = command.replace(/\\\r?\n/g, '').trim();
	if (normalized === '') return null;

	const segments: string[] = [];
	let current = '';
	let quote: '"' | "'" | null = null;

	const push = () => {
		const segment = current.trim();
		if (segment !== '') segments.push(segment);
		current = '';
	};

	for (let i = 0; i < normalized.length; i++) {
		const char = normalized[i];

		if (quote !== null) {
			current += char;
			if (char === '\\' && quote === '"') {
				current += normalized[++i] ?? '';
			} else if (char === quote) {
				quote = null;
			}
			continue;
		}

		if (char === '\\') {
			current += char + (normalized[++i] ?? '');
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			continue;
		}

		// Constructs that can hide another command inside this one.
		if ('`(){}<>'.includes(char)) return null;

		if (char === ';' || char === '\n') {
			push();
			continue;
		}

		if (char === '&') {
			if (normalized[i + 1] === '&') {
				i++;
				push();
				continue;
			}
			// A lone `&` backgrounds the command; refuse to reason about it.
			return null;
		}

		if (char === '|') {
			if (normalized[i + 1] === '|') i++;
			push();
			continue;
		}

		current += char;
	}

	// An unterminated quote means the split is unreliable.
	if (quote !== null) return null;
	push();
	return segments.length > 0 ? segments : null;
}

function parseRules(
	rules: readonly string[] | undefined,
	toolName: string,
): PermissionRule[] {
	if (!Array.isArray(rules)) return [];

	const parsed: PermissionRule[] = [];
	for (const rule of rules) {
		if (typeof rule !== 'string') continue;
		const entry = parsePermissionRule(rule);
		if (entry && entry.tool === toolName) {
			parsed.push({...entry, source: rule.trim()});
		}
	}
	return parsed;
}

function denialReason(rule: PermissionRule): string {
	return rule.pattern === undefined
		? `Tool "${rule.tool}" is denied by nanocoder.permissions.deny.`
		: `Command denied by nanocoder.permissions.deny rule "${rule.source}".`;
}

/**
 * Apply `nanocoder.permissions` to one tool call.
 *
 * Rule order: deny matches first and wins over allow, over `alwaysAllow`, and
 * over every development mode. Allow only skips the prompt when it covers
 * every simple command in the line; otherwise the call is left to the normal
 * approval policy.
 *
 * `command` is only supplied for tools that take a shell command
 * (`execute_bash`). Pattern rules for other tools are inert; bare tool rules
 * still apply to them.
 */
export function evaluatePermissionRules(
	toolName: string,
	command: string | undefined,
	permissions?: PermissionsConfig,
): PermissionRuleDecision {
	const denyRules = parseRules(permissions?.deny, toolName);
	const allowRules = parseRules(permissions?.allow, toolName);
	if (denyRules.length === 0 && allowRules.length === 0) {
		return {allowed: false};
	}

	const trimmedCommand = command?.trim();
	const simpleCommands =
		trimmedCommand === undefined ? null : splitSimpleCommands(trimmedCommand);

	for (const rule of denyRules) {
		if (rule.pattern === undefined) {
			return {allowed: false, deniedReason: denialReason(rule)};
		}
		if (trimmedCommand === undefined) continue;
		const pattern = rule.pattern;
		// Match the whole line as well as each part, so a deny pattern can span
		// separators (`*--force*`) instead of only seeing one simple command.
		if (matchesCommandPattern(pattern, trimmedCommand)) {
			return {allowed: false, deniedReason: denialReason(rule)};
		}
		if (simpleCommands?.some(cmd => matchesCommandPattern(pattern, cmd))) {
			return {allowed: false, deniedReason: denialReason(rule)};
		}
	}

	if (allowRules.some(rule => rule.pattern === undefined)) {
		return {allowed: true};
	}
	if (simpleCommands === null) {
		return {allowed: false};
	}

	const allowed = simpleCommands.every(cmd =>
		allowRules.some(
			rule =>
				rule.pattern !== undefined && matchesCommandPattern(rule.pattern, cmd),
		),
	);
	return {allowed};
}
