import {
	RUN_FLAGS_STANDALONE,
	RUN_FLAGS_WITH_VALUES,
} from './run-prompt-args.js';

const COMMANDS = [
	'run',
	'review',
	'worktree',
	'swarm',
	'init',
	'copilot',
	'codex',
	'daemon',
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
	const match = findSuggestion(command, COMMANDS);
	return match
		? `Unknown command "${command}". Did you mean "${match}"?`
		: `Unknown command "${command}". Run "nanocoder --help" to see available commands.`;
}

function validateTopLevelArgs(args: string[], end: number): string | undefined {
	for (let i = 0; i < end; i++) {
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
		if (arg.startsWith('-')) return unknownOptionError(arg);
		return unknownCommandError(arg);
	}
	return undefined;
}

/**
 * Reject misspelled top-level options and commands before the app starts.
 * Arguments after `run` are deliberately left alone because they are prompt
 * text, where option-looking tokens may be part of the user's request.
 */
export function validateCliArgs(args: string[]): string | undefined {
	// These parse their own arguments (a free-form prompt plus their own flags).
	if (args[0] === 'review' || args[0] === 'worktree' || args[0] === 'swarm')
		return undefined;

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
