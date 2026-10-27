import {
	RUN_FLAGS_STANDALONE,
	RUN_FLAGS_WITH_VALUES,
} from './run-prompt-args.js';

/** Top-level commands. Exported so the completion spec can be checked against it. */
export const COMMANDS = [
	'run',
	'review',
	'worktree',
	'init',
	'copilot',
	'codex',
	'daemon',
	'verify',
	'skills',
	'config',
	'storage',
	'completion',
] as const;

const FLAGS_WITH_VALUES = new Set(RUN_FLAGS_WITH_VALUES);
const FLAGS_WITHOUT_VALUES = new Set([
	...RUN_FLAGS_STANDALONE,
	'--continue',
	'--resume',
	'--acp',
	'-c',
	'-r',
	'-v',
	'-h',
]);

function editDistance(left: string, right: string): number {
	const row = Array.from({length: right.length + 1}, (_, index) => index);
	for (let i = 1; i <= left.length; i++) {
		let diagonal = row[0];
		row[0] = i;
		for (let j = 1; j <= right.length; j++) {
			const above = row[j];
			row[j] = Math.min(
				row[j] + 1,
				row[j - 1] + 1,
				diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
			);
			diagonal = above;
		}
	}
	return row[right.length];
}

function isSingleTransposition(left: string, right: string): boolean {
	if (left.length !== right.length) return false;
	const differences: number[] = [];
	for (let i = 0; i < left.length; i++) {
		if (left[i] !== right[i]) differences.push(i);
	}
	if (differences.length !== 2) return false;
	const [first, second] = differences;
	return (
		second === first + 1 &&
		left[first] === right[second] &&
		left[second] === right[first]
	);
}

function findSuggestion(
	value: string,
	candidates: readonly string[],
): string | undefined {
	let closest: string | undefined;
	let closestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		const distance = editDistance(value, candidate);
		const threshold = Math.max(1, Math.floor(candidate.length * 0.3));
		if (
			(distance <= threshold || isSingleTransposition(value, candidate)) &&
			distance < closestDistance
		) {
			closest = candidate;
			closestDistance = distance;
		}
	}
	return closest;
}

function unknownOptionError(option: string): string {
	const optionName = option.split('=', 1)[0];
	const candidates = [...FLAGS_WITH_VALUES, ...FLAGS_WITHOUT_VALUES];
	const match = findSuggestion(optionName, candidates);
	return match
		? `Unknown option "${option}". Did you mean "${match}"?`
		: `Unknown option "${option}". Run "nanocoder --help" to see available options.`;
}

function unknownCommandError(command: string): string {
	// An option typed without its dashes, e.g. `nanocoder acp` for `--acp`.
	// Other agents (opencode) start ACP with a bare `acp` subcommand.
	const option = `--${command}`;
	if (FLAGS_WITH_VALUES.has(option) || FLAGS_WITHOUT_VALUES.has(option)) {
		return `Unknown command "${command}". Did you mean "${option}"?`;
	}
	const match = findSuggestion(command, COMMANDS);
	// Never suggest the word the user already typed: a known command only
	// reaches here when it is out of position (see misplacedCommandError).
	return match && match !== command
		? `Unknown command "${command}". Did you mean "${match}"?`
		: `Unknown command "${command}". Run "nanocoder --help" to see available commands.`;
}

/**
 * A known command typed after one or more options, e.g.
 * `nanocoder --trust-directory daemon start`. Commands are only recognised
 * as the first argument, so point at the working order instead of claiming
 * the command does not exist.
 */
function misplacedCommandError(args: string[], commandIndex: number): string {
	const command = args[commandIndex];
	const reordered = [
		command,
		...args.slice(commandIndex + 1),
		...args.slice(0, commandIndex),
	].join(' ');
	return `Put "${command}" first: nanocoder ${reordered}`;
}

interface ScannedArgs {
	/** Indexes of arguments that are neither a known option nor its value. */
	positionals: number[];
	/** Set when an unknown option is found; scanning stops there. */
	error?: string;
}

/** Walk `args[start..end)`, skipping known options and their values. */
function scanArgs(args: string[], start: number, end: number): ScannedArgs {
	const positionals: number[] = [];
	for (let i = start; i < end; i++) {
		const arg = args[i];
		if (FLAGS_WITH_VALUES.has(arg)) {
			const value = args[i + 1];
			if (value && !value.startsWith('-') && value !== 'run') i++;
			continue;
		}
		if ([...FLAGS_WITH_VALUES].some(flag => arg.startsWith(`${flag}=`))) {
			continue;
		}
		if (FLAGS_WITHOUT_VALUES.has(arg)) {
			if (arg === '--resume' || arg === '-r') {
				const value = args[i + 1];
				if (value && !value.startsWith('-') && value !== 'run') i++;
			}
			continue;
		}
		if (arg.startsWith('-')) {
			return {positionals, error: unknownOptionError(arg)};
		}
		positionals.push(i);
	}
	return {positionals};
}

function validateTopLevelArgs(args: string[], end: number): string | undefined {
	const {positionals, error} = scanArgs(args, 0, end);
	const first = positionals[0];
	// An unknown option before the first positional wins; otherwise report
	// the positional, which comes first on the command line.
	if (first === undefined) return error;
	if ((COMMANDS as readonly string[]).includes(args[first])) {
		return misplacedCommandError(args, first);
	}
	return unknownCommandError(args[first]);
}

const WORKTREE_USAGE =
	'Usage: nanocoder worktree <PR-number> [options] (a positive GitHub PR number is required).';

/**
 * Split `nanocoder worktree ...` into its PR-number positionals and options.
 * Global options (`--provider`, `--model`, `--mode`, ...) may follow or
 * precede the PR number and are read by the normal startup path, so the
 * session in the new worktree honours them. Returns the positional
 * arguments (callers require exactly one PR number) or an error message.
 */
export function parseWorktreeArgs(
	args: string[],
): {positionals: string[]} | {error: string} {
	const {positionals, error} = scanArgs(args, 1, args.length);
	if (error) return {error};
	const values = positionals.map(index => args[index]);
	if (values.length !== 1) return {error: WORKTREE_USAGE};
	return {positionals: values};
}

/**
 * Reject misspelled top-level options and commands before the app starts.
 * Arguments after `run` are deliberately left alone because they are prompt
 * text, where option-looking tokens may be part of the user's request.
 */
export function validateCliArgs(args: string[]): string | undefined {
	if (args[0] === 'review') return undefined;

	if (args[0] === 'worktree') {
		const result = parseWorktreeArgs(args);
		return 'error' in result ? result.error : undefined;
	}

	if (args[0] === 'codex' || args[0] === 'copilot') {
		if (args[1] === 'login') return undefined;
		const command = args[0];
		const match = findSuggestion(args[1] ?? '', ['login']);
		return match
			? `Unknown ${command} subcommand "${args[1]}". Did you mean "${match}"?`
			: `Usage: nanocoder ${command} login [provider-name]`;
	}

	const runCommandIndex = args.indexOf('run');
	const end = runCommandIndex === -1 ? args.length : runCommandIndex;
	return validateTopLevelArgs(args, end);
}
