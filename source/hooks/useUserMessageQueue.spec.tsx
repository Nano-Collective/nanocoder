import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import type {ImageAttachment} from '@/types/core';
import {PlaceholderType} from '@/types/hooks';
import {useUserMessageQueue} from './useUserMessageQueue';

type HookResult = ReturnType<typeof useUserMessageQueue>;

function TestHook({onResult}: {onResult: (result: HookResult) => void}) {
	const result = useUserMessageQueue();

	React.useEffect(() => {
		onResult(result);
	}, [result, onResult]);

	return <></>;
}

async function renderHook() {
	let hook: HookResult | null = null;
	const rendered = render(
		<TestHook
			onResult={result => {
				hook = result;
			}}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 20));

	if (!hook) {
		throw new Error('hook did not render');
	}

	return {
		...rendered,
		get hook() {
			if (!hook) {
				throw new Error('hook did not render');
			}
			return hook;
		},
	};
}

test('useUserMessageQueue enqueues messages with stable payloads', async t => {
	const result = await renderHook();
	const image: ImageAttachment = {
		data: 'abc123',
		mediaType: 'image/png',
		source: 'screenshot.png',
	};

	result.hook.enqueueMessage({
		message: 'full message',
		displayValue: 'display message',
		images: [image],
	});

	await new Promise(resolve => setTimeout(resolve, 20));

	t.is(result.hook.queuedMessages.length, 1);
	t.is(result.hook.queuedMessages[0].message, 'full message');
	t.is(result.hook.queuedMessages[0].displayValue, 'display message');
	t.deepEqual(result.hook.queuedMessages[0].images, [image]);
	t.truthy(result.hook.queuedMessages[0].id);
	result.unmount();
});

test('useUserMessageQueue preserves placeholder input state metadata', async t => {
	const result = await renderHook();
	const inputState = {
		displayValue: 'summarize [@file:1]',
		placeholderContent: {
			'file:1': {
				type: PlaceholderType.FILE,
				content: 'file contents',
				displayText: '[@file:1]',
				filePath: 'source/example.ts',
			},
		},
	};

	result.hook.enqueueMessage({
		message: 'summarize file contents',
		displayValue: inputState.displayValue,
		inputState,
	});

	await new Promise(resolve => setTimeout(resolve, 20));

	t.deepEqual(result.hook.queuedMessages[0].inputState, inputState);
	result.unmount();
});

test('useUserMessageQueue drains messages in FIFO order', async t => {
	const result = await renderHook();
	const sent: string[] = [];

	result.hook.enqueueMessage({message: 'first', displayValue: 'First'});
	result.hook.enqueueMessage({message: 'second', displayValue: 'Second'});

	await new Promise(resolve => setTimeout(resolve, 20));

	const firstDrained = await result.hook.drainNextMessage(message => {
		sent.push(message.message);
		return true;
	});

	await new Promise(resolve => setTimeout(resolve, 20));

	const secondDrained = await result.hook.drainNextMessage(message => {
		sent.push(message.message);
		return true;
	});

	await new Promise(resolve => setTimeout(resolve, 20));

	t.true(firstDrained);
	t.true(secondDrained);
	t.deepEqual(sent, ['first', 'second']);
	t.is(result.hook.queuedMessages.length, 0);
	result.unmount();
});

test('useUserMessageQueue removes a draining message before dispatch resolves', async t => {
	const result = await renderHook();
	const sent: string[] = [];
	let resolveFirstDispatch!: () => void;
	const firstDispatchFinished = new Promise<void>(resolve => {
		resolveFirstDispatch = resolve;
	});

	result.hook.enqueueMessage({message: 'first', displayValue: 'First'});
	result.hook.enqueueMessage({message: 'second', displayValue: 'Second'});

	await new Promise(resolve => setTimeout(resolve, 20));

	const firstDrain = result.hook.drainNextMessage(async message => {
		sent.push(message.message);
		await firstDispatchFinished;
		return true;
	});

	await new Promise(resolve => setTimeout(resolve, 20));

	t.deepEqual(
		result.hook.queuedMessages.map(message => message.message),
		['second'],
	);

	const secondDrain = await result.hook.drainNextMessage(message => {
		sent.push(message.message);
		return true;
	});

	resolveFirstDispatch();

	t.true(await firstDrain);
	t.true(secondDrain);
	await new Promise(resolve => setTimeout(resolve, 20));
	t.deepEqual(sent, ['first', 'second']);
	t.is(result.hook.queuedMessages.length, 0);
	result.unmount();
});

test('useUserMessageQueue keeps message queued when dispatch cannot run', async t => {
	const result = await renderHook();

	result.hook.enqueueMessage({
		message: 'retry later',
		displayValue: 'Retry later',
	});

	await new Promise(resolve => setTimeout(resolve, 20));

	const drained = await result.hook.drainNextMessage(() => false);

	await new Promise(resolve => setTimeout(resolve, 20));

	t.false(drained);
	t.is(result.hook.queuedMessages.length, 1);
	t.is(result.hook.queuedMessages[0].message, 'retry later');
	result.unmount();
});

test('useUserMessageQueue keeps message queued when async dispatch rejects', async t => {
	const result = await renderHook();

	result.hook.enqueueMessage({
		message: 'retry after rejection',
		displayValue: 'Retry after rejection',
	});

	await new Promise(resolve => setTimeout(resolve, 20));

	const drained = await result.hook.drainNextMessage(async () => {
		throw new Error('dispatch failed');
	});

	await new Promise(resolve => setTimeout(resolve, 20));

	t.false(drained);
	t.is(result.hook.queuedMessages.length, 1);
	t.is(result.hook.queuedMessages[0].message, 'retry after rejection');
	result.unmount();
});

test('useUserMessageQueue removes a queued message by id', async t => {
	const result = await renderHook();

	result.hook.enqueueMessage({message: 'keep', displayValue: 'Keep'});
	result.hook.enqueueMessage({message: 'remove', displayValue: 'Remove'});

	await new Promise(resolve => setTimeout(resolve, 20));

	const idToRemove = result.hook.queuedMessages[1].id;
	result.hook.removeMessage(idToRemove);

	await new Promise(resolve => setTimeout(resolve, 20));

	t.deepEqual(
		result.hook.queuedMessages.map(message => message.message),
		['keep'],
	);
	result.unmount();
});
