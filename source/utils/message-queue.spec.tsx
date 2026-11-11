import test from 'ava';
import React from 'react';
import {getLogger} from './logging';
import {ErrorMessage, InfoMessage, WarningMessage} from '@/components/message-box';
import {
	addToMessageQueue,
	notifyError,
	notifyInfo,
	notifyWarning,
	setGlobalMessageQueue,
	setMessageQueueSink,
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

function queuedTypes(queue: CallSpy<[React.ReactNode]>): unknown[] {
	return queue.calls.map(([node]) => (node as React.ReactElement).type);
}

function queuedProps(
	queue: CallSpy<[React.ReactNode]>,
	index: number,
): {message: string; hideBox: boolean} {
	return (queue.calls[index][0] as React.ReactElement).props as {
		message: string;
		hideBox: boolean;
	};
}

test.serial(
	'addToMessageQueue logs a warning when no queue has been registered yet',
	t => {
		const logger = getLogger();
		const warn = spy<[string | object, ...unknown[]]>();
		const originalWarn = logger.warn;
		logger.warn = warn as typeof logger.warn;

		try {
			addToMessageQueue(React.createElement('div'));
		} finally {
			logger.warn = originalWarn;
		}

		t.is(warn.calls.length, 1);
		t.is(
			warn.calls[0][0],
			'[message-queue] Queue not available, component not added',
		);
	},
);

test.serial('addToMessageQueue is a no-op when no queue is registered', t => {
	setGlobalMessageQueue(() => {});
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	addToMessageQueue(React.createElement('div'));

	t.is(queue.calls.length, 1);
});

test.serial('notifyInfo dispatches an InfoMessage component to the queue', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	notifyInfo('hello info');

	t.deepEqual(queuedTypes(queue), [InfoMessage]);
	t.is(queuedProps(queue, 0).message, 'hello info');
	t.true(queuedProps(queue, 0).hideBox);
});

test.serial('notifyError and notifyWarning dispatch their own components', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);

	notifyError('boom', false);
	notifyWarning('careful');

	t.deepEqual(queuedTypes(queue), [ErrorMessage, WarningMessage]);
	t.false(queuedProps(queue, 0).hideBox);
});

test.serial('the sink receives each message with its type and source', t => {
	const queue = spy<[React.ReactNode]>();
	setGlobalMessageQueue(queue);
	const sink = spy<[string, string, {source?: string} | undefined]>();
	setMessageQueueSink(sink);

	try {
		notifyInfo('from custom source', true, {source: 'my-module'});
		notifyError('error from custom source', false, {error: new Error('cause')});
	} finally {
		setMessageQueueSink(null);
	}

	t.deepEqual(
		sink.calls.map(([type, message, options]) => [
			type,
			message,
			options?.source,
		]),
		[
			['info', 'from custom source', 'my-module'],
			['error', 'error from custom source', 'notifyError'],
		],
	);
	t.is(queue.calls.length, 2);
});
