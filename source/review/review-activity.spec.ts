import test from 'ava';
import {
	parseReviewActivitySummary,
	ReviewActivityStore,
} from './review-activity';

test('activity spans retain stable IDs and report progress, timing, and completion', t => {
	let now = 10;
	const store = new ReviewActivityStore({
		reviewId: 'review-test',
		now: () => now,
	});
	const changes: number[] = [];
	store.subscribe(() => changes.push(store.getEvents().length));

	const span = store.begin({
		source: 'tool',
		name: 'git rev-parse',
		args: ['rev-parse', 'HEAD'],
		summary: 'Pinning repository revision',
	});
	t.is(store.getEvents()[0]?.status, 'started');
	now = 20;
	span.progress('Resolved the current commit');
	t.is(store.getEvents()[0]?.status, 'progress');
	now = 35;
	span.complete('Repository revision pinned');
	store.finish('completed');

	const summary = store.toSummary();
	t.is(summary.events.length, 1);
	t.is(summary.events[0]?.id, span.id);
	t.is(summary.events[0]?.status, 'completed');
	t.is(summary.events[0]?.durationMs, 25);
	t.deepEqual(
		summary.events[0]?.updates.map(update => update.summary),
		['Pinning repository revision', 'Resolved the current commit', 'Repository revision pinned'],
	);
	t.is(summary.status, 'completed');
	t.deepEqual(changes, [1, 1, 1, 1]);
});

test('activity errors and arguments are bounded and secrets are redacted', t => {
	const store = new ReviewActivityStore({reviewId: 'safe-review'});
	const event = store.begin({
		source: 'api',
		name: 'GitHub API request',
		args: [
			'api',
			'Authorization: Bearer ghp_1234567890abcdefghijklmnop',
			'password=hunter2',
			'https://user:password@example.test/path',
			'--api-key',
			'this-is-a-private-key-value',
			'x'.repeat(500),
		],
		summary: 'Fetching metadata for https://user:password@example.test/pull/1',
	});
	event.fail(
		new Error('request failed: token=abc-secret-value\nAuthorization: Bearer opaque'),
		'Could not read PR metadata',
	);

	const [entry] = store.toSummary().events;
	t.truthy(entry);
	t.false(JSON.stringify(entry).includes('ghp_1234567890'));
	t.false(JSON.stringify(entry).includes('hunter2'));
	t.false(JSON.stringify(entry).includes('password@example.test'));
	t.false(JSON.stringify(entry).includes('private-key-value'));
	t.false(JSON.stringify(entry).includes('abc-secret-value'));
	t.false(JSON.stringify(entry).includes('opaque'));
	t.true((entry?.safeArgs?.[4]?.length ?? 0) <= 160);
	t.is(entry?.status, 'failed');
	t.true(Number.isFinite(entry?.durationMs));
	t.true((entry?.durationMs ?? -1) >= 0);
});

test('activity log keeps only the configured number of events', t => {
	const store = new ReviewActivityStore({
		reviewId: 'bounded-review',
		maxEvents: 2,
		maxUpdatesPerEvent: 2,
	});

	for (let i = 0; i < 3; i++) {
		const event = store.begin({
			source: 'review',
			name: `phase-${i}`,
			summary: `Started phase ${i}`,
		});
		event.progress(`Updated phase ${i}`);
		event.complete(`Finished phase ${i}`);
	}

	const summary = store.toSummary();
	t.is(summary.events.length, 2);
	t.is(summary.droppedEventCount, 1);
	t.deepEqual(
		summary.events.map(event => event.name),
		['phase-1', 'phase-2'],
	);
	t.deepEqual(
		summary.events[0]?.updates.map(update => update.summary),
		['Updated phase 1', 'Finished phase 1'],
	);
});

test('cancelled and failed activities serialize into a bounded inspectable summary', t => {
	const store = new ReviewActivityStore({reviewId: 'persisted-review'});
	store.begin({
		source: 'review',
		name: 'Target discovery',
		summary: 'Searching configured refs',
	}).cancel('Stopped by user');
	store.begin({
		source: 'api',
		name: 'PR metadata',
		summary: 'Reading pinned pull request metadata',
	}).fail(new Error('HTTP 404'));
	store.finish('cancelled');

	const parsed = parseReviewActivitySummary(
		JSON.parse(JSON.stringify(store.toSummary())),
	);
	t.truthy(parsed);
	t.is(parsed?.status, 'cancelled');
	t.is(parsed?.events[0]?.status, 'cancelled');
	t.is(parsed?.events[1]?.status, 'failed');
	t.is(parseReviewActivitySummary({version: 99}), null);
});

test('terminal activity status cannot be changed after completion', t => {
	const store = new ReviewActivityStore({reviewId: 'terminal-review'});
	const span = store.begin({
		source: 'agent',
		name: 'future-agent',
		summary: 'Waiting for future coordinator',
	});
	span.complete();
	span.fail(new Error('late failure'));
	store.finish('completed');

	t.is(store.toSummary().events[0]?.status, 'completed');
	t.is(store.getStatus(), 'completed');
});
