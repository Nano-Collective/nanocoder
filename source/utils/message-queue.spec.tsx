import test from 'ava';
import React from 'react';
import {
	addToMessageQueue,
	checkMessageQueueHealth,
	getMessageQueueStats,
	logApiCall,
	logError,
	logInfo,
	logSuccess,
	logToolExecution,
	logUserAction,
	logWarning,
	resetMessageQueueStats,
	setGlobalMessageQueue,
} from './message-queue';

console.log('\nmessage-queue.spec.tsx');

interface CallSpy<T extends unknown[] = unknown[]> {
	(...args: T): void;
	calls: T[];
}

function spy<T extends unknown[] = unknown[]>(): CallSpy<T> {
	const fn = ((...args: T) => {
		fn.calls.push(args);
	}) as CallSpy<T>;
	fn.calls = [];
	return fn;
}

test.beforeEach(() => {
	resetMessageQueueStats();
});

test.serial('addToMessageQueue is a no-op when no queue is registered', t => {
	setGlobalMessageQueue(() => {});
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	addToMessageQueue(React.createElement('div'));

	t.is(queue.calls.length, 1);
});

test.serial('logInfo dispatches an InfoMessage component to the queue', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	logInfo('hello info');

	t.is(queue.calls.length, 1);
	const stats = getMessageQueueStats();
	t.is(stats.messagesByType.info, 1);
	t.is(stats.totalMessages, 1);
});

test.serial('logError increments the error counter', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	logError('boom');

	const stats = getMessageQueueStats();
	t.is(stats.messagesByType.error, 1);
	t.is(stats.errorsLogged, 1);
});

test.serial('logSuccess and logWarning update their counters independently', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	logSuccess('ok');
	logWarning('careful');
	logWarning('careful again');

	const stats = getMessageQueueStats();
	t.is(stats.messagesByType.success, 1);
	t.is(stats.messagesByType.warning, 2);
	t.is(stats.totalMessages, 3);
});

test.serial('logApiCall logs as info for 2xx and as error for 4xx/5xx', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	logApiCall('GET', '/users', 200, 12);
	logApiCall('POST', '/users', 500, 42);

	const stats = getMessageQueueStats();
	t.is(stats.messagesByType.info, 1);
	t.is(stats.messagesByType.error, 1);
	t.is(stats.errorsLogged, 1);
});

test.serial('logToolExecution maps started/completed/failed to the correct levels', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	logToolExecution('bash', 'started');
	logToolExecution('bash', 'completed', 12);
	logToolExecution('bash', 'failed', 99, {error: new Error('exec failed')});

	const stats = getMessageQueueStats();
	t.is(stats.messagesByType.info, 1);
	t.is(stats.messagesByType.success, 1);
	t.is(stats.messagesByType.error, 1);
});

test.serial('logUserAction always emits an info message', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	logUserAction('clicked-submit', {target: 'form'});
	logUserAction('opened-menu');

	const stats = getMessageQueueStats();
	t.is(stats.messagesByType.info, 2);
	t.is(stats.totalMessages, 2);
});

test.serial('resetMessageQueueStats zeroes all counters', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	logInfo('first');
	logError('second');
	t.is(getMessageQueueStats().totalMessages, 2);

	resetMessageQueueStats();

	const stats = getMessageQueueStats();
	t.is(stats.totalMessages, 0);
	t.is(stats.messagesByType.info, 0);
	t.is(stats.messagesByType.error, 0);
	t.is(stats.errorsLogged, 0);
});

test.serial('checkMessageQueueHealth flags high error rate', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	// 1 info + 4 errors → 80% error rate, well over the 20% threshold
	logInfo('ok');
	logError('bad 1');
	logError('bad 2');
	logError('bad 3');
	logError('bad 4');

	const result = checkMessageQueueHealth();
	t.false(result.isHealthy);
	t.true(result.issues.some(issue => issue.includes('High error rate')));
});

test.serial('checkMessageQueueHealth reports healthy when stats are clean', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	logInfo('one');
	logInfo('two');
	logSuccess('three');

	const result = checkMessageQueueHealth();
	t.true(result.isHealthy);
	t.deepEqual(result.issues, []);
});

test.serial('getMessageQueueStats returns a copy, not the live object', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	logInfo('one');
	const snapshot = getMessageQueueStats();

	logInfo('two');
	const updated = getMessageQueueStats();

	t.is(snapshot.totalMessages, 1);
	t.is(updated.totalMessages, 2);
	t.not(snapshot, updated);
});

test.serial('options.source overrides default source string without erroring', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	logInfo('from custom source', true, {source: 'my-module'});
	logError('error from custom source', false, {
		source: 'my-module',
		error: new Error('cause'),
	});

	const stats = getMessageQueueStats();
	t.is(stats.messagesByType.info, 1);
	t.is(stats.messagesByType.error, 1);
});
