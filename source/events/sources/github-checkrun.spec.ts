import test from 'ava';
import {EventRouter} from '@/events/event-router';
import type {Event, Subscription, SubscriptionDispatcher} from '@/events/types';
import {CiEventSource} from './github-checkrun';

console.log('\ngithub-checkrun.spec.ts');

function captureRouter(): {router: EventRouter; events: Event[]} {
	const events: Event[] = [];
	const dispatcher: SubscriptionDispatcher = {
		dispatch(_sub, event) {
			events.push(event);
		},
	};
	const router = new EventRouter(dispatcher);
	return {router, events};
}

function ciSub(): Subscription {
	return {
		id: 'builtin:ci-investigator',
		kind: 'ci.job.failed',
		target: {kind: 'agent', name: 'verify-ci-investigator'},
		source: 'manifest',
		ownerSkill: 'builtin',
	};
}

function stubScheduler(): {
	scheduleFn: (fn: () => void, ms: number) => NodeJS.Timeout;
	clearFn: (handle: NodeJS.Timeout) => void;
	calls: Array<{fn: () => void; ms: number}>;
} {
	const calls: Array<{fn: () => void; ms: number}> = [];
	const scheduleFn = (fn: () => void, ms: number): NodeJS.Timeout => {
		calls.push({fn, ms});
		return {} as NodeJS.Timeout;
	};
	return {scheduleFn, clearFn: () => {}, calls};
}

function runListJson(entries: unknown[]): string {
	return JSON.stringify(entries);
}

const FAILED_RUN = {
	databaseId: 42,
	conclusion: 'failure',
	headSha: 'abc1234',
	workflowName: 'CI',
	url: 'https://github.com/o/r/actions/runs/42',
	headBranch: 'feature-x',
};

test('emits ci.job.failed and calls onDetected for a new failing run', async t => {
	const {router, events} = captureRouter();
	router.subscribe(ciSub());
	const scheduler = stubScheduler();
	const detected: unknown[] = [];

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		execGhFn: async () => runListJson([FAILED_RUN]),
		onDetected: payload => detected.push(payload),
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await source.start();

	t.is(events.length, 1);
	t.is(events[0]?.kind, 'ci.job.failed');
	if (events[0]?.kind === 'ci.job.failed') {
		t.is(events[0].payload.runId, 42);
		t.is(events[0].payload.branch, 'feature-x');
	}
	t.is(detected.length, 1);
});

test('does not re-emit for a run already seen', async t => {
	const {router, events} = captureRouter();
	router.subscribe(ciSub());
	const scheduler = stubScheduler();

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		execGhFn: async () => runListJson([FAILED_RUN]),
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await source.start();
	t.is(events.length, 1);

	// Simulate the next scheduled poll tick.
	scheduler.calls[0]?.fn();
	await new Promise(r => setImmediate(r));

	t.is(events.length, 1, 'same run id must not emit twice');
});

test('a passing run emits nothing', async t => {
	const {router, events} = captureRouter();
	router.subscribe(ciSub());
	const scheduler = stubScheduler();

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		execGhFn: async () =>
			runListJson([{...FAILED_RUN, conclusion: 'success'}]),
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await source.start();

	t.is(events.length, 0);
});

test('a gh error grows the backoff interval instead of throwing', async t => {
	const {router} = captureRouter();
	const scheduler = stubScheduler();

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		pollIntervalMs: 100,
		execGhFn: async () => {
			throw new Error('gh: rate limited');
		},
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await t.notThrowsAsync(() => source.start());
	t.is(scheduler.calls[0]?.ms, 100);

	scheduler.calls[0]?.fn();
	await new Promise(r => setImmediate(r));

	t.is(scheduler.calls[1]?.ms, 200, 'second consecutive failure should back off further');
});

test('unparseable output backs off instead of retrying at the fixed interval', async t => {
	const {router} = captureRouter();
	const scheduler = stubScheduler();

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		pollIntervalMs: 100,
		execGhFn: async () => 'not json {{{',
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await source.start();
	t.is(scheduler.calls[0]?.ms, 100);

	scheduler.calls[0]?.fn();
	await new Promise(r => setImmediate(r));

	t.is(
		scheduler.calls[1]?.ms,
		200,
		'a second consecutive parse failure should back off further, not retry at the base interval',
	);
});

test('a successful poll resets the backoff after prior failures', async t => {
	const {router} = captureRouter();
	const scheduler = stubScheduler();
	let callCount = 0;

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		pollIntervalMs: 100,
		execGhFn: async () => {
			callCount++;
			if (callCount === 1) throw new Error('transient');
			if (callCount === 2) return runListJson([]);
			throw new Error('transient again');
		},
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await source.start(); // call 1: fails, backoff -> 100, attempt now 1
	t.is(scheduler.calls[0]?.ms, 100);

	scheduler.calls[0]?.fn();
	await new Promise(r => setImmediate(r)); // call 2: succeeds, resets backoff
	t.is(scheduler.calls[1]?.ms, 100);

	scheduler.calls[1]?.fn();
	await new Promise(r => setImmediate(r)); // call 3: fails again, should back off from a fresh attempt=0
	t.is(scheduler.calls[2]?.ms, 100, 'backoff should restart from base after the reset');
});

test('stop prevents any further polls from being scheduled', async t => {
	const {router, events} = captureRouter();
	router.subscribe(ciSub());
	const scheduler = stubScheduler();

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		execGhFn: async () => runListJson([FAILED_RUN]),
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await source.start();
	const callsBefore = scheduler.calls.length;
	source.stop();

	// Even if a stray already-scheduled callback fires after stop(), it must
	// not schedule another poll.
	scheduler.calls[callsBefore - 1]?.fn();
	await new Promise(r => setImmediate(r));

	t.is(scheduler.calls.length, callsBefore, 'no new poll should be scheduled after stop()');
	t.is(events.length, 1, 'the already-emitted event count should be unaffected');
});
