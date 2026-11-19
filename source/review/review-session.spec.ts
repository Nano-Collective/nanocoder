import test from 'ava';
import type {Message} from '@/types/core';
import {filterModelFacing} from '@/conversation/message-visibility';
import {ReviewActivityStore} from './review-activity';
import {
	createReviewMessage,
	findLatestPersistedReview,
	readPersistedReview,
} from './review-session';

function finishedActivity(name: string) {
	const store = new ReviewActivityStore();
	store.begin({source: 'agent', name, summary: 'Looking for defects'}).complete('Finished');
	store.finish('completed');
	return store.toSummary();
}

test('a review survives a session save round-trip and stays out of the provider payload', t => {
	const message = createReviewMessage({
		report: '## Grounded review · completed',
		tier: 'Grounded',
		status: 'completed',
		activity: finishedActivity('finder'),
	});
	const restored = JSON.parse(JSON.stringify(message)) as Message;

	t.is(restored.role, 'assistant');
	t.true(restored.displayOnly);
	t.is(restored.content, '## Grounded review · completed');
	const review = readPersistedReview(restored);
	t.is(review?.status, 'completed');
	t.is(review?.tier, 'Grounded');
	t.is(review?.activity.events[0]?.name, 'finder');
	t.deepEqual(filterModelFacing([{role: 'user', content: '/review'}, restored]), [
		{role: 'user', content: '/review'},
	]);
});

test('tampered or unrelated structured content is not treated as a review', t => {
	const valid = createReviewMessage({
		report: 'r',
		tier: 'Grounded',
		status: 'incomplete',
		activity: finishedActivity('finder'),
	});
	const withContent = (structuredContent: unknown): Message =>
		({...valid, structuredContent}) as Message;

	t.is(readPersistedReview({role: 'assistant', content: 'plain'}), null);
	t.is(readPersistedReview({...valid, role: 'user'}), null);
	t.is(readPersistedReview(withContent({kind: 'other', version: 1})), null);
	t.is(
		readPersistedReview(
			withContent({...(valid.structuredContent as object), status: 'hacked'}),
		),
		null,
	);
	t.is(
		readPersistedReview(
			withContent({...(valid.structuredContent as object), activity: {events: 'x'}}),
		),
		null,
	);
	t.is(
		readPersistedReview(
			withContent({...(valid.structuredContent as object), tier: '\u001b[31mEvil'}),
		)?.tier,
		'Grounded',
	);
});

test('finds the most recent review in a transcript', t => {
	const first = createReviewMessage({
		report: 'first',
		tier: 'Grounded',
		status: 'completed',
		activity: finishedActivity('first finder'),
	});
	const second = createReviewMessage({
		report: 'second',
		tier: 'Grounded',
		status: 'incomplete',
		activity: finishedActivity('second finder'),
	});
	const review = findLatestPersistedReview([
		first,
		{role: 'user', content: 'thanks'},
		second,
		{role: 'assistant', content: 'anything else?'},
	]);
	t.is(review?.activity.events[0]?.name, 'second finder');
	t.is(findLatestPersistedReview([{role: 'user', content: 'hi'}]), null);
});
