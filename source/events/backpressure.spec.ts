import test from 'ava';
import {BackpressureDispatcher} from './backpressure';
import type {SubscriptionDispatcher} from './event-router';
import type {Event, Subscription} from './types';

console.log(`\nbackpressure.spec.ts`);

function recording(
	delayMs = 0,
): SubscriptionDispatcher & {
	calls: Array<{sub: Subscription; event: Event}>;
} {
	const calls: Array<{sub: Subscription; event: Event}> = [];
	return {
		calls,
		async dispatch(sub, event) {
			calls.push({sub, event});
			if (delayMs > 0) {
				await new Promise(r => setTimeout(r, delayMs));
			}
		},
	};
}

function fileSub(id: string): Subscription {
	return {
		id,
		kind: 'file.changed',
		target: {kind: 'agent', name: 'docs'},
		source: 'frontmatter',
		ownerSkill: 'docs',
	};
}

function cronSub(id: string): Subscription {
	return {
		id,
		kind: 'schedule.cron',
		target: {kind: 'command', name: 'weekly'},
		source: 'manifest',
		ownerSkill: 'reports',
	};
}

function fileEvent(file: string): Event {
	return {kind: 'file.changed', payload: {file, eventKind: 'change'}, at: Date.now()};
}

function cronEvent(cron: string): Event {
	return {kind: 'schedule.cron', payload: {cron}, at: Date.now()};
}

const DEBOUNCE = 30;

test.serial('debounces file.changed: only the last event in a burst fires', async t => {
	const inner = recording();
	const bp = new BackpressureDispatcher(inner, {debounceMs: DEBOUNCE});

	for (const file of ['a.md', 'b.md', 'c.md']) {
		void bp.dispatch(fileSub('s1'), fileEvent(file));
	}
	await new Promise(r => setTimeout(r, DEBOUNCE + 20));

	t.is(inner.calls.length, 1);
	if (inner.calls[0]?.event.kind === 'file.changed') {
		t.is(inner.calls[0].event.payload.file, 'c.md');
	}
	bp.dispose();
});

test.serial('cron events skip the debouncer and dispatch immediately', async t => {
	const inner = recording();
	const bp = new BackpressureDispatcher(inner, {debounceMs: DEBOUNCE});

	await bp.dispatch(cronSub('s1'), cronEvent('* * * * *'));
	t.is(inner.calls.length, 1);
	bp.dispose();
});

test.serial('per-subscription concurrency cap drops events while in flight', async t => {
	const inner = recording(80);
	const bp = new BackpressureDispatcher(inner, {debounceMs: DEBOUNCE});
	const dropped: Array<{sub: Subscription; event: Event}> = [];
	const bpWithDrop = new BackpressureDispatcher(inner, {
		debounceMs: DEBOUNCE,
		onDrop: (sub, event) => dropped.push({sub, event}),
	});

	// Fire one event, await it kicking off, then immediately fire a second.
	void bpWithDrop.dispatch(cronSub('s1'), cronEvent('a'));
	await new Promise(r => setTimeout(r, 10));
	await bpWithDrop.dispatch(cronSub('s1'), cronEvent('b'));

	t.is(dropped.length, 1);
	t.is(inner.calls.length, 1);

	// Wait for first run to settle, then send another - this one should land.
	await new Promise(r => setTimeout(r, 100));
	await bpWithDrop.dispatch(cronSub('s1'), cronEvent('c'));
	t.is(inner.calls.length, 2);

	bp.dispose();
	bpWithDrop.dispose();
});

test.serial('different subscriptions debounce independently', async t => {
	const inner = recording();
	const bp = new BackpressureDispatcher(inner, {debounceMs: DEBOUNCE});

	void bp.dispatch(fileSub('a'), fileEvent('x.md'));
	void bp.dispatch(fileSub('b'), fileEvent('y.md'));
	await new Promise(r => setTimeout(r, DEBOUNCE + 20));

	t.is(inner.calls.length, 2);
	const ids = inner.calls.map(c => c.sub.id).sort();
	t.deepEqual(ids, ['a', 'b']);
	bp.dispose();
});

test.serial('dispose cancels pending debounce timers', async t => {
	const inner = recording();
	const bp = new BackpressureDispatcher(inner, {debounceMs: DEBOUNCE});

	void bp.dispatch(fileSub('s1'), fileEvent('a.md'));
	bp.dispose();
	await new Promise(r => setTimeout(r, DEBOUNCE + 20));

	t.is(inner.calls.length, 0);
});
