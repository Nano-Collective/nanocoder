/**
 * Parse CLI args for the `nanocoder review` subcommand.
 *
 * Extracted from cli.tsx so the logic is testable without importing the
 * full entry-point module (which c8/ava cannot instrument).
 *
 * The flag lists come from `run-prompt-args`, not from a copy kept here.
 * This module used to filter against its own list and had already drifted:
 * it did not know `--mouse` / `--no-mouse`, so `nanocoder review --mouse main`
 * kept `main` as a second positional and rejected the user's own branch name
 * as an extra argument.
 */

import {RUN_FLAGS_STANDALONE, RUN_FLAGS_WITH_VALUES} from '@/run-prompt-args';

export type ReviewCliResult = {
	isReviewCommand: boolean;
	prompt: string | undefined;
	error: string | undefined;
};

/** The words that are not flags, in order. */
function positionalArgs(args: string[]): string[] {
	const positionals: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (RUN_FLAGS_WITH_VALUES.includes(arg)) {
			i++; // skip the value too
			continue;
		}
		if (RUN_FLAGS_WITH_VALUES.some(flag => arg.startsWith(`${flag}=`))) {
			continue; // fused form carries its own value
		}
		if (RUN_FLAGS_STANDALONE.includes(arg)) {
			continue;
		}
		positionals.push(arg);
	}
	return positionals;
}

export function parseReviewCliArgs(args: string[]): ReviewCliResult {
	const isReviewCommand = args[0] === 'review';
	if (!isReviewCommand) {
		return {isReviewCommand: false, prompt: undefined, error: undefined};
	}

	const positionals = positionalArgs(args.slice(1));

	if (positionals.length === 0) {
		return {isReviewCommand: true, prompt: '/review', error: undefined};
	}

	if (positionals.length > 1) {
		const extra = positionals.slice(1).join(', ');
		return {
			isReviewCommand: true,
			prompt: undefined,
			error: `Review accepts only one target (branch name or PR number). Extra arguments: ${extra}`,
		};
	}

	return {
		isReviewCommand: true,
		prompt: `/review ${positionals[0]}`,
		error: undefined,
	};
}
