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

		// `$'...'` is ANSI-C quoting: bash expands escapes inside it, so the
		// text our quote tracking sees is not what the shell runs. Refuse to
		// reason about it rather than risk a hidden command.
		if (char === '$' && normalized[i + 1] === "'") return null;

		// An unquoted `#` that starts a word begins a comment through the end
		// of the line. Treating the rest as command text lets a `'` in the
		// comment open a quote that spans newlines (and hides the next line).
		if (char === '#' && startsWord(normalized, i)) return null;

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

/**
 * True when `index` begins a shell word: at the start, or after an unquoted
 * blank/operator. Used to tell a comment (`# ...`) from a literal `#` inside
 * a word (`foo#bar`).
 */
function startsWord(command: string, index: number): boolean {
	if (index === 0) return true;
	return /[\s;&|()<>]/.test(command[index - 1]);
}

/**
 * Split a line on separators without refusing constructs the strict splitter
 * rejects. This is only used to look for deny-rule matches, where a false
 * positive refuses a command (safe) and a false negative runs it (unsafe).
 */
function splitCommandsPermissively(command: string): string[] {
	const normalized = command.replace(/\\\r?\n/g, '').trim();
	if (normalized === '') return [];

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

		if (char === '#' && startsWord(normalized, i)) {
			// The rest of the line is a comment, not a command.
			break;
		}

		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			continue;
		}

		if (char === ';' || char === '\n') {
			push();
			continue;
		}

		if (char === '&') {
			if (normalized[i + 1] === '&') i++;
			push();
			continue;
		}

		if (char === '|') {
			if (normalized[i + 1] === '|') i++;
			push();
			continue;
		}

		current += char;
	}

	push();
	return segments;
}

/** Collapse runs of whitespace so `rm  -rf` matches a `rm -rf *` rule. */
function normalizeWhitespace(command: string): string {
	return command.replace(/\s+/g, ' ').trim();
}

/**
 * Split a command into shell words, removing quotes and escapes. Returns null
 * when quoting is not understood; the whole-line check still runs.
 */
function tokenizeCommand(command: string): string[] | null {
	const tokens: string[] = [];
	let current = '';
	let quote: '"' | "'" | null = null;
	let started = false;

	const push = () => {
		if (started) tokens.push(current);
		current = '';
		started = false;
	};

	for (let i = 0; i < command.length; i++) {
		const char = command[i];

		if (quote !== null) {
			if (char === '\\' && quote === '"') {
				current += command[++i] ?? '';
				started = true;
				continue;
			}
			if (char === quote) {
				quote = null;
				started = true;
				continue;
			}
			current += char;
			started = true;
			continue;
		}

		if (char === '\\') {
			current += command[++i] ?? '';
			started = true;
			continue;
		}

		if (char === '$' && command[i + 1] === "'") return null;

		if (char === '#' && startsWord(command, i)) {
			// The rest of the line is a comment, not a command.
			break;
		}

		if (char === '"' || char === "'") {
			quote = char;
			started = true;
			continue;
		}

		if (/\s/.test(char)) {
			push();
			continue;
		}

		current += char;
		started = true;
	}

	if (quote !== null) return null;
	push();
	return tokens;
}

const WRAPPER_COMMANDS = new Set([
	'command',
	'doas',
	'env',
	'exec',
	'ionice',
	'nice',
	'nohup',
	'stdbuf',
	'sudo',
	'time',
	'xargs',
]);

const SHELL_COMMANDS = new Set(['bash', 'dash', 'fish', 'ksh', 'sh', 'zsh']);

function commandBasename(word: string): string {
	const slash = word.lastIndexOf('/');
	return slash === -1 ? word : word.slice(slash + 1);
}

/**
 * The forms of a command a deny rule should be tested against. Deny is a hard
 * refusal, so matching is deliberately broader than allow: it also looks past
 * a privilege wrapper (`sudo curl ...`) and inside `sh -c "curl ..."`, and
 * strips a leading path (`/bin/rm`). A pattern that merely appears in an
 * argument (`echo "curl ..."`) is not treated as a command.
 */
function denyCandidates(command: string): string[] {
	const candidates = new Set<string>([normalizeWhitespace(command)]);
	const tokens = tokenizeCommand(command);
	if (!tokens || tokens.length === 0) return [...candidates];

	let index = 0;
	let sawWrapper = false;

	while (index < tokens.length) {
		const base = commandBasename(tokens[index] ?? '');

		if (WRAPPER_COMMANDS.has(base)) {
			sawWrapper = true;
			index++;
			continue;
		}

		if (SHELL_COMMANDS.has(base)) {
			const cIndex = tokens.indexOf('-c', index + 1);
			const script = cIndex === -1 ? undefined : tokens[cIndex + 1];
			if (script !== undefined) {
				for (const nested of denyCandidates(script)) {
					candidates.add(nested);
				}
			}
			sawWrapper = true;
			index++;
			continue;
		}

		if (base === 'eval') {
			for (const nested of denyCandidates(tokens.slice(index + 1).join(' '))) {
				candidates.add(nested);
			}
			index++;
			continue;
		}

		break;
	}

	// A wrapper can carry options and assignments before the real command.
	// Testing every suffix catches `sudo -u root curl ...` and
	// `env FOO=1 curl ...` without treating ordinary arguments as commands.
	if (sawWrapper) {
		for (let i = index; i < tokens.length; i++) {
			candidates.add(normalizeWhitespace(tokens.slice(i).join(' ')));
		}
	}

	if (index < tokens.length) {
		candidates.add(
			normalizeWhitespace(
				[commandBasename(tokens[index] ?? ''), ...tokens.slice(index + 1)].join(
					' ',
				),
			),
		);
	}

	return [...candidates];
}

function denyMatches(
	pattern: string,
	wholeLine: string,
	simpleCommands: string[] | null,
): boolean {
	const commands = simpleCommands ?? splitCommandsPermissively(wholeLine);
	for (const command of [wholeLine, ...commands]) {
		for (const candidate of denyCandidates(command)) {
			if (matchesCommandPattern(pattern, candidate)) return true;
		}
	}
	return false;
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
		if (denyMatches(rule.pattern, trimmedCommand, simpleCommands)) {
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
