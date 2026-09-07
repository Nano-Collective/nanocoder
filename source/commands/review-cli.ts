/**
 * Parse CLI args for the `nanocoder review` subcommand.
 *
 * Extracted from cli.tsx so the logic is testable without importing the
 * full entry-point module (which c8/ava cannot instrument).
 */

import {filterCliFlags} from '@/utils/cli-flags';

export type ReviewCliResult = {
	isReviewCommand: boolean;
	prompt: string | undefined;
	error: string | undefined;
};

export function parseReviewCliArgs(args: string[]): ReviewCliResult {
	const isReviewCommand = args[0] === 'review';
	if (!isReviewCommand) {
		return {isReviewCommand: false, prompt: undefined, error: undefined};
	}

	const afterReviewArgs = args.slice(1);
	const positionals = filterCliFlags(afterReviewArgs);

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
