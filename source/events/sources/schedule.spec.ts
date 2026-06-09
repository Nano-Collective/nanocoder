import test from 'ava';
import {EventRouter} from '@/events/event-router';
import type {Event, Subscription, SubscriptionDispatcher} from '@/events/types';
import type {CronFactory, CronJobLike} from './schedule';
import {ScheduleEventSource} from './schedule';

console.log(`\nschedule.spec.ts`);

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

function stubFactory(): {
	factory: CronFactory;
	jobs: Array<{expression: string; onTick: () => void; job: CronJobLike}>;
	stops: string[];
} {
	const jobs: Array<{expression: string; onTick: () => void; job: CronJobLike}> = [];
	const stops: string[] = [];
	const factory: CronFactory = (expression, onTick) => {
		const job: CronJobLike = {
			stop: () => stops.push(expression),
		};
		jobs.push({expression, onTick, job});
		return job;
	};
	return {factory, jobs, stops};
}

function cronSub(id: string, cron: string): Subscription {
	return {
		id,
		kind: 'schedule.cron',
		target: {kind: 'command', name: 'weekly-report'},
		source: 'manifest',
		ownerSkill: 'reports',
		filter: {cron},
	};
}

test('register installs one job per expression', t => {
	const {router} = captureRouter();
	const stub = stubFactory();
	const source = new ScheduleEventSource(router, stub.factory);

	source.register('0 9 * * MON');
	source.register('0 9 * * MON'); // dup, no-op
	source.register('*/5 * * * *');
	t.deepEqual(source.listRegistered().sort(), [
		'*/5 * * * *',
		'0 9 * * MON',
	]);
	t.is(stub.jobs.length, 2);
});

test('tick emits schedule.cron event with the expression in payload', async t => {
	const {router, events} = captureRouter();
	const stub = stubFactory();
	const source = new ScheduleEventSource(router, stub.factory);

	router.subscribe(cronSub('s1', '0 9 * * MON'));
	source.register('0 9 * * MON');

	stub.jobs[0]?.onTick();
	await new Promise(r => setImmediate(r));

	t.is(events.length, 1);
	t.is(events[0]?.kind, 'schedule.cron');
	if (events[0]?.kind === 'schedule.cron') {
		t.is(events[0].payload.cron, '0 9 * * MON');
	}
});

test('multiple cron expressions fire independently', async t => {
	const {router, events} = captureRouter();
	const stub = stubFactory();
	const source = new ScheduleEventSource(router, stub.factory);

	router.subscribe(cronSub('a', '0 9 * * MON'));
	router.subscribe(cronSub('b', '*/5 * * * *'));
	source.register('0 9 * * MON');
	source.register('*/5 * * * *');

	stub.jobs[1]?.onTick();
	await new Promise(r => setImmediate(r));

	t.is(events.length, 1);
	t.is(
		events[0]?.kind === 'schedule.cron' ? events[0].payload.cron : '',
		'*/5 * * * *',
	);
});

test('unregister stops the job and removes from the map', t => {
	const {router} = captureRouter();
	const stub = stubFactory();
	const source = new ScheduleEventSource(router, stub.factory);

	source.register('0 9 * * MON');
	source.unregister('0 9 * * MON');

	t.deepEqual(source.listRegistered(), []);
	t.deepEqual(stub.stops, ['0 9 * * MON']);
});

test('unregister on unknown expression is a no-op', t => {
	const {router} = captureRouter();
	const stub = stubFactory();
	const source = new ScheduleEventSource(router, stub.factory);
	source.unregister('never registered');
	t.deepEqual(stub.stops, []);
});

test('stop clears all jobs', t => {
	const {router} = captureRouter();
	const stub = stubFactory();
	const source = new ScheduleEventSource(router, stub.factory);

	source.register('a');
	source.register('b');
	source.stop();
	t.deepEqual(source.listRegistered(), []);
	t.is(stub.stops.length, 2);
});

test('one tick dispatches to multiple subscriptions sharing the expression', async t => {
	const {router, events} = captureRouter();
	const stub = stubFactory();
	const source = new ScheduleEventSource(router, stub.factory);

	router.subscribe(cronSub('a', '* * * * *'));
	router.subscribe(cronSub('b', '* * * * *'));
	source.register('* * * * *');

	stub.jobs[0]?.onTick();
	await new Promise(r => setImmediate(r));

	t.is(events.length, 2);
});
