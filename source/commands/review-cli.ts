/**
 * Parse CLI args for the `nanocoder review` subcommand.
 *
 * Extracted from cli.tsx so the logic is testable without importing the
 * full entry-point module (which c8/ava cannot instrument).
 */

export type ReviewCliResult = {
	isReviewCommand: boolean;
	prompt: string | undefined;
};

export function parseReviewCliArgs(args: string[]): ReviewCliResult {
	const isReviewCommand = args[0] === 'review';
	if (!isReviewCommand) {
		return {isReviewCommand: false, prompt: undefined};
	}

	const afterReviewArgs = args.slice(1);
	const reviewArgs: string[] = [];
	for (let i = 0; i < afterReviewArgs.length; i++) {
		const arg = afterReviewArgs[i];
		if (
			arg === '--vscode' ||
			arg === '--json' ||
			arg === '--trust-directory' ||
			arg === '--plain' ||
			arg === '--no-plain' ||
			arg === '--no-alt-screen' ||
			arg === '--alt-screen'
		) {
			continue;
		} else if (
			arg === '--vscode-port' ||
			arg === '--provider' ||
			arg === '--model' ||
			arg === '--context-max' ||
			arg === '--output-format'
		) {
			i++; // skip this flag and its value
			continue;
		} else if (arg === '--mode') {
			i++; // skip this flag and its value
			continue;
		} else if (arg.startsWith('--mode=')) {
			continue;
		} else if (arg.startsWith('--output-format=')) {
			continue;
		} else {
			reviewArgs.push(arg);
		}
	}

	if (reviewArgs.length === 0) {
		return {isReviewCommand: true, prompt: '/review'};
	}
	return {isReviewCommand: true, prompt: `/review ${reviewArgs[0]}`};
}
