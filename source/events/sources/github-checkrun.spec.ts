import test from 'ava';
import {TIMEOUT_GH_METADATA_MS} from '@/constants';
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

/** Fires the given scheduled call and drains microtasks so `pollOnce`'s
 * chain of awaits (execGhFn, router.emit) settles before assertions run. */
async function fireScheduled(call: {fn: () => void} | undefined): Promise<void> {
	call?.fn();
	await new Promise(r => setImmediate(r));
}

const FAILED_RUN = {
	databaseId: 42,
	conclusion: 'failure',
	headSha: 'abc1234',
	workflowName: 'CI',
	url: 'https://github.com/o/r/actions/runs/42',
	headBranch: 'feature-x',
};

test('start() schedules the first poll rather than awaiting it inline', async t => {
	const {router} = captureRouter();
	const scheduler = stubScheduler();
	let execGhCalls = 0;

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		execGhFn: async () => {
			execGhCalls++;
			return runListJson([]);
		},
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await source.start();

	t.is(execGhCalls, 0, 'start() must resolve before the first gh call happens');
	t.is(scheduler.calls[0]?.ms, 0, 'the first poll is scheduled for 0ms');

	await fireScheduled(scheduler.calls[0]);
	t.is(execGhCalls, 1, 'firing the scheduled call performs the first poll');
});

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
	await fireScheduled(scheduler.calls[0]);

	t.is(events.length, 1);
	t.is(events[0]?.kind, 'ci.job.failed');
	if (events[0]?.kind === 'ci.job.failed') {
		t.is(events[0].payload.runId, 42);
		t.is(events[0].payload.branch, 'feature-x');
	}
	t.is(detected.length, 1);
});

test('pollOnce passes TIMEOUT_GH_METADATA_MS to execGhFn', async t => {
	const {router} = captureRouter();
	const scheduler = stubScheduler();
	const calls: Array<[string[], number | undefined]> = [];

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		execGhFn: async (args, timeoutMs) => {
			calls.push([args, timeoutMs]);
			return runListJson([]);
		},
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await source.start();
	await fireScheduled(scheduler.calls[0]);

	t.is(calls.length, 1);
	t.is(calls[0]?.[1], TIMEOUT_GH_METADATA_MS);
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
	await fireScheduled(scheduler.calls[0]);
	t.is(events.length, 1);

	// Simulate the next scheduled poll tick.
	await fireScheduled(scheduler.calls[1]);

	t.is(events.length, 1, 'same run id must not emit twice');
});

test('initialSeenFailedRunIds suppresses re-emit of a run seen before construction', async t => {
	const {router, events} = captureRouter();
	router.subscribe(ciSub());
	const scheduler = stubScheduler();

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		execGhFn: async () => runListJson([FAILED_RUN]),
		initialSeenFailedRunIds: [FAILED_RUN.databaseId],
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await source.start();
	await fireScheduled(scheduler.calls[0]);

	t.is(events.length, 0, 'a run id seeded via initialSeenFailedRunIds must not re-emit');
});

test('onSeenFailedRunIdsChanged fires with updated ids on a new failure, not on a repeat', async t => {
	const {router} = captureRouter();
	router.subscribe(ciSub());
	const scheduler = stubScheduler();
	const changes: number[][] = [];

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		execGhFn: async () => runListJson([FAILED_RUN]),
		onSeenFailedRunIdsChanged: ids => changes.push(ids),
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await source.start();
	await fireScheduled(scheduler.calls[0]);
	t.deepEqual(changes, [[FAILED_RUN.databaseId]]);

	await fireScheduled(scheduler.calls[1]);
	t.is(changes.length, 1, 'no callback fires when the poll finds nothing new');
});

test('two workflows failing in the same poll both emit', async t => {
	const {router, events} = captureRouter();
	router.subscribe(ciSub());
	const scheduler = stubScheduler();
	const otherFailedRun = {
		...FAILED_RUN,
		databaseId: 43,
		workflowName: 'Lint',
	};

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		execGhFn: async () => runListJson([FAILED_RUN, otherFailedRun]),
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await source.start();
	await fireScheduled(scheduler.calls[0]);

	t.is(events.length, 2);
	const workflowNames = events
		.filter((e): e is Extract<Event, {kind: 'ci.job.failed'}> => e.kind === 'ci.job.failed')
		.map(e => e.payload.workflowName);
	t.deepEqual(new Set(workflowNames), new Set(['CI', 'Lint']));
});

test('only the latest run per workflow is considered — older failures of the same workflow in the fetch window are ignored', async t => {
	const {router, events} = captureRouter();
	router.subscribe(ciSub());
	const scheduler = stubScheduler();

	// A single fresh activation on a branch whose last few completed runs for
	// one workflow are all historically-broken failures. Only the newest
	// (first in gh's newest-first ordering) should be treated as "currently
	// red" for that workflow — the rest are stale backlog, not fresh
	// detections, and must not each trigger their own investigation.
	const staleFailures = [
		{...FAILED_RUN, databaseId: 10, workflowName: 'CI'},
		{...FAILED_RUN, databaseId: 9, workflowName: 'CI'},
		{...FAILED_RUN, databaseId: 8, workflowName: 'CI'},
	];

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		execGhFn: async () => runListJson(staleFailures),
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await source.start();
	await fireScheduled(scheduler.calls[0]);

	t.is(events.length, 1, 'only the newest run for the workflow should emit');
	if (events[0]?.kind === 'ci.job.failed') {
		t.is(events[0].payload.runId, 10);
	}
});

test('timed_out and startup_failure conclusions emit; cancelled/success/neutral do not', async t => {
	const {router, events} = captureRouter();
	router.subscribe(ciSub());
	const scheduler = stubScheduler();

	// Distinct workflow names: pollOnce only ever considers the latest run
	// per workflow, so each conclusion needs its own workflow to be
	// evaluated independently rather than being collapsed into one.
	const runs = [
		{...FAILED_RUN, databaseId: 1, workflowName: 'wf-1', conclusion: 'timed_out'},
		{...FAILED_RUN, databaseId: 2, workflowName: 'wf-2', conclusion: 'startup_failure'},
		{...FAILED_RUN, databaseId: 3, workflowName: 'wf-3', conclusion: 'cancelled'},
		{...FAILED_RUN, databaseId: 4, workflowName: 'wf-4', conclusion: 'success'},
		{...FAILED_RUN, databaseId: 5, workflowName: 'wf-5', conclusion: 'neutral'},
	];

	const source = new CiEventSource(router, {
		branch: 'feature-x',
		execGhFn: async () => runListJson(runs),
		scheduleFn: scheduler.scheduleFn,
		clearFn: scheduler.clearFn,
	});

	await source.start();
	await fireScheduled(scheduler.calls[0]);

	t.is(events.length, 2);
	const emittedIds = events
		.filter((e): e is Extract<Event, {kind: 'ci.job.failed'}> => e.kind === 'ci.job.failed')
		.map(e => e.payload.runId);
	t.deepEqual(new Set(emittedIds), new Set([1, 2]));
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
	await fireScheduled(scheduler.calls[0]);

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
	await fireScheduled(scheduler.calls[0]);
	t.is(scheduler.calls[1]?.ms, 100);

	await fireScheduled(scheduler.calls[1]);

	t.is(scheduler.calls[2]?.ms, 200, 'second consecutive failure should back off further');
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
	await fireScheduled(scheduler.calls[0]);
	t.is(scheduler.calls[1]?.ms, 100);

	await fireScheduled(scheduler.calls[1]);

	t.is(
		scheduler.calls[2]?.ms,
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

	await source.start(); // scheduled poll 1 (0ms)
	await fireScheduled(scheduler.calls[0]); // call 1: fails, backoff -> 100
	t.is(scheduler.calls[1]?.ms, 100);

	await fireScheduled(scheduler.calls[1]); // call 2: succeeds, resets backoff
	t.is(scheduler.calls[2]?.ms, 100);

	await fireScheduled(scheduler.calls[2]); // call 3: fails again, fresh attempt=0
	t.is(scheduler.calls[3]?.ms, 100, 'backoff should restart from base after the reset');
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
	await fireScheduled(scheduler.calls[0]);
	const callsBefore = scheduler.calls.length;
	source.stop();

	// Even if a stray already-scheduled callback fires after stop(), it must
	// not schedule another poll.
	await fireScheduled(scheduler.calls[callsBefore - 1]);

	t.is(scheduler.calls.length, callsBefore, 'no new poll should be scheduled after stop()');
	t.is(events.length, 1, 'the already-emitted event count should be unaffected');
});
