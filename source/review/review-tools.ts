import {execGh, execGit, execGitBuffer} from '@/tools/git/utils';
import type {
	ReviewActivitySource,
	ReviewActivityStore,
} from './review-activity';

export interface ReviewFoundationTools {
	execGit: (
		args: string[],
		signal?: AbortSignal,
		env?: Record<string, string>,
	) => Promise<string>;
	execGitBuffer: (args: string[], signal?: AbortSignal) => Promise<Buffer>;
	execGh: (args: string[], signal?: AbortSignal) => Promise<string>;
	githubRepositoryUrl?: (repository: string) => string;
}

export const defaultReviewFoundationTools: ReviewFoundationTools = {
	execGit: (args, signal, env) => execGit(args, undefined, {signal, env}),
	execGitBuffer: (args, signal) => execGitBuffer(args, undefined, {signal}),
	execGh: (args, signal) => execGh(args, undefined, {signal}),
	githubRepositoryUrl: repository => `https://github.com/${repository}.git`,
};

export class ReviewCancelledError extends Error {
	constructor() {
		super('Review cancelled.');
		this.name = 'AbortError';
	}
}

export function throwIfReviewAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new ReviewCancelledError();
}

export async function trackReviewOperation<T>(
	store: ReviewActivityStore,
	source: Extract<ReviewActivitySource, 'tool' | 'api'>,
	name: string,
	args: string[],
	summary: string,
	signal: AbortSignal | undefined,
	operation: () => Promise<T>,
): Promise<T> {
	const span = store.begin({source, name, args, summary});
	try {
		throwIfReviewAborted(signal);
		const result = await operation();
		span.complete(summary);
		return result;
	} catch (error) {
		if (signal?.aborted || error instanceof ReviewCancelledError) {
			span.cancel('Cancelled by user');
		} else {
			span.fail(error);
		}
		throw error;
	}
}
