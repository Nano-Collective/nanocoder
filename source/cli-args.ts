import {
	RUN_FLAGS_STANDALONE,
	RUN_FLAGS_WITH_VALUES,
} from './run-prompt-args.js';
import {
	DEFAULT_SWARM_TIMEOUT_MINUTES,
	DEFAULT_SWARM_WORKERS,
	MAX_SWARM_WORKERS,
	SWARM_MODES,
	type SwarmConfig,
	type SwarmMode,
} from './swarm/types.js';

/** Top-level commands. Exported so the completion spec can be checked against it. */
export const COMMANDS = [
	'run',
	'review',
	'worktree',
	'swarm',
	'init',
	'copilot',
	'codex',
	'daemon',
	'verify',
	'skills',
	'config',
	'trust',
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

/** Options that belong to `nanocoder init` rather than the global set. */
const INIT_FLAGS_WITH_VALUES = ['--preset'] as const;
const INIT_FLAGS_WITHOUT_VALUES = [
	'--force',
	'-f',
	'--lean',
	'--help',
	'-h',
] as const;

/** The options a scan accepts. */
interface FlagSet {
	readonly withValues: readonly string[];
	readonly withoutValues: readonly string[];
}

/** Flags whose value may legitimately start with `-` (a negative number). */
const NEGATIVE_VALUE_FLAGS = new Set([
	'--context-max',
	'--vscode-port',
	'--workers',
	'--timeout',
]);

const GLOBAL_FLAGS: FlagSet = {
	withValues: [...FLAGS_WITH_VALUES],
	withoutValues: [...FLAGS_WITHOUT_VALUES],
};

/**
 * `nanocoder review` accepts the `run` flags — exactly the list
 * `review-cli.ts` filters its positionals with, so the scan and the parser
 * cannot drift apart.
 */
const REVIEW_FLAGS: FlagSet = {
	withValues: RUN_FLAGS_WITH_VALUES,
	withoutValues: RUN_FLAGS_STANDALONE,
};

/** `init` only honours its own options; global flags are not valid here. */
const INIT_FLAGS: FlagSet = {
	withValues: INIT_FLAGS_WITH_VALUES,
	withoutValues: INIT_FLAGS_WITHOUT_VALUES,
};

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

function unknownOptionError(
	option: string,
	candidates: readonly string[],
): string {
	const optionName = option.split('=', 1)[0];
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

/**
 * Whether `value` can be the value of the preceding option. A negative number
 * counts only for the numeric flags (`--context-max -5`), so it reaches value
 * validation instead of being read as an unknown `-5` flag, while free-form
 * flags such as `--provider` keep rejecting it.
 */
function isValueToken(
	value: string | undefined,
	allowNegativeNumber: boolean,
): boolean {
	if (value === undefined || value === 'run') return false;
	// An explicitly empty argument is still this flag's value: consuming it
	// lets the flag's own validation report the empty value instead of the
	// scanner mistaking it for a command or positional.
	if (value === '') return true;
	if (!value.startsWith('-')) return true;
	return allowNegativeNumber && /^-\d/.test(value);
}

/** Walk `args[start..end)`, skipping known options and their values. */
function scanArgs(
	args: string[],
	start: number,
	end: number,
	flags: FlagSet = GLOBAL_FLAGS,
): ScannedArgs {
	const positionals: number[] = [];
	for (let i = start; i < end; i++) {
		const arg = args[i];
		if (flags.withValues.includes(arg)) {
			if (isValueToken(args[i + 1], NEGATIVE_VALUE_FLAGS.has(arg))) i++;
			continue;
		}
		if (flags.withValues.some(flag => arg.startsWith(`${flag}=`))) {
			continue;
		}
		if (flags.withoutValues.includes(arg)) {
			if (
				(arg === '--resume' || arg === '-r') &&
				isValueToken(args[i + 1], false)
			) {
				i++;
			}
			continue;
		}
		if (arg.startsWith('-')) {
			return {
				positionals,
				error: unknownOptionError(arg, [
					...flags.withValues,
					...flags.withoutValues,
				]),
			};
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

const SWARM_USAGE =
	'Usage: nanocoder swarm "<goal>" [--workers 1-10] [--swarm-mode review|apply|yolo] [--timeout <minutes>]';

/** `swarm` takes only these: any other option would be silently ignored. */
const SWARM_FLAGS: FlagSet = {
	withValues: [
		'--provider',
		'--model',
		'--profile',
		'--context-max',
		'--workers',
		'--swarm-mode',
		'--timeout',
	],
	withoutValues: ['--trust-directory'],
};

function flagValue(args: string[], flag: string): string | undefined {
	const index = args.findIndex(
		arg => arg === flag || arg.startsWith(`${flag}=`),
	);
	if (index === -1) return undefined;
	return args[index] === flag
		? (args[index + 1] ?? '')
		: args[index].slice(flag.length + 1);
}

export function parseSwarmArgs(
	args: string[],
): {config: SwarmConfig; trustDirectory: boolean} | {error: string} {
	const {positionals, error} = scanArgs(args, 1, args.length, SWARM_FLAGS);
	if (error) return {error};

	const prompt = positionals
		.map(index => args[index])
		.join(' ')
		.trim();
	if (!prompt) return {error: SWARM_USAGE};

	const integer = (value: string) =>
		/^\d+$/.test(value) ? Number(value) : Number.NaN;

	const workersValue = flagValue(args, '--workers');
	const workers =
		workersValue === undefined ? DEFAULT_SWARM_WORKERS : integer(workersValue);
	if (!(workers >= 1 && workers <= MAX_SWARM_WORKERS)) {
		return {
			error: `Invalid --workers value: "${workersValue}". Must be an integer between 1 and ${MAX_SWARM_WORKERS}.`,
		};
	}

	const modeValue = flagValue(args, '--swarm-mode') ?? 'review';
	if (!(SWARM_MODES as readonly string[]).includes(modeValue)) {
		return {
			error: `Invalid --swarm-mode value: "${modeValue}". Must be 'review', 'apply', or 'yolo'.`,
		};
	}

	const timeoutValue = flagValue(args, '--timeout');
	const minutes =
		timeoutValue === undefined
			? DEFAULT_SWARM_TIMEOUT_MINUTES
			: integer(timeoutValue);
	// A day, which also keeps the delay within what a timer accepts.
	if (!(minutes >= 1 && minutes <= 1440)) {
		return {
			error: `Invalid --timeout value: "${timeoutValue}". Must be a whole number of minutes between 1 and 1440.`,
		};
	}

	return {
		config: {
			prompt,
			workers,
			swarmMode: modeValue as SwarmMode,
			timeoutMs: minutes * 60_000,
		},
		trustDirectory: args.includes('--trust-directory'),
	};
}

/**
 * Reject options `nanocoder init` does not honour. `init` has its own fast
 * path in `cli.tsx` that runs before the global scan, so it calls this
 * directly with its own flag set: a global flag such as `--provider` is just
 * as unsupported here as a misspelled one, and accepting it would silently
 * ignore it — the bug this validation exists to prevent.
 */
export function validateInitArgs(args: string[]): string | undefined {
	const {error} = scanArgs(args, 1, args.length, INIT_FLAGS);
	return error;
}

/**
 * Reject misspelled top-level options and commands before the app starts.
 * Arguments after `run` are deliberately left alone because they are prompt
 * text, where option-looking tokens may be part of the user's request.
 */
export function validateCliArgs(args: string[]): string | undefined {
	if (args[0] === 'review') {
		// `init` is not handled here: it has its own fast path in `cli.tsx`
		// that exits before this function is reached, and it validates through
		// `validateInitArgs`. Scanning `review` with the same flag list its
		// parser uses stops `review --bogus main` from being reported as an
		// extra review target.
		return scanArgs(args, 1, args.length, REVIEW_FLAGS).error;
	}

	if (args[0] === 'worktree') {
		const result = parseWorktreeArgs(args);
		return 'error' in result ? result.error : undefined;
	}

	if (args[0] === 'swarm') {
		const result = parseSwarmArgs(args);
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
