import type {JSONValue} from 'ai';
import type {Message} from '@/types/core';
import {
	parseReviewActivitySummary,
	type ReviewActivitySummary,
} from './review-activity';
import type {GroundedReviewStatus} from './run-grounded-review';

export const REVIEW_MESSAGE_KIND = 'nanocoder.review';

export interface PersistedReview {
	kind: typeof REVIEW_MESSAGE_KIND;
	version: 1;
	tier: string;
	status: GroundedReviewStatus;
	activity: ReviewActivitySummary;
}

const STATUSES: readonly GroundedReviewStatus[] = [
	'completed',
	'incomplete',
	'failed',
	'cancelled',
	'clarification',
	'empty',
];

/**
 * Build the transcript entry for a finished review. It is display-only, so
 * the report is replayed on resume but never sent to the model, and it
 * carries the bounded, sanitized activity summary (no prompts or diffs).
 */
export function createReviewMessage(input: {
	report: string;
	tier: string;
	status: GroundedReviewStatus;
	activity: ReviewActivitySummary;
}): Message {
	const persisted: PersistedReview = {
		kind: REVIEW_MESSAGE_KIND,
		version: 1,
		tier: input.tier,
		status: input.status,
		activity: input.activity,
	};
	return {
		role: 'assistant',
		content: input.report,
		displayOnly: true,
		structuredContent: persisted as unknown as JSONValue,
	};
}

/** Read a persisted review back from an untrusted, possibly old session file. */
export function readPersistedReview(message: Message): PersistedReview | null {
	const value = message.structuredContent as
		| Partial<PersistedReview>
		| null
		| undefined;
	if (
		message.role !== 'assistant' ||
		!value ||
		typeof value !== 'object' ||
		value.kind !== REVIEW_MESSAGE_KIND ||
		value.version !== 1
	) {
		return null;
	}
	const activity = parseReviewActivitySummary(value.activity);
	if (!activity) return null;
	const status = STATUSES.includes(value.status as GroundedReviewStatus)
		? (value.status as GroundedReviewStatus)
		: null;
	if (!status) return null;
	const tier =
		typeof value.tier === 'string' && /^[A-Za-z ]{1,20}$/.test(value.tier)
			? value.tier
			: 'Grounded';
	return {kind: REVIEW_MESSAGE_KIND, version: 1, tier, status, activity};
}

export function findLatestPersistedReview(
	messages: Message[],
): PersistedReview | null {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		const review = message ? readPersistedReview(message) : null;
		if (review) return review;
	}
	return null;
}
