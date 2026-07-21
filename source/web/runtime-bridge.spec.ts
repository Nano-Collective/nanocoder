import test from 'ava';
import type {WebServerEvent} from './protocol.js';
import {createWebRuntimeBridge} from './runtime-bridge.js';

const userMessage = (id: string, text = 'hello') => ({
	type: 'user_message' as const,
	id,
	text,
});

test('web runtime bridge rejects messages until the runtime is ready', async t => {
	const bridge = createWebRuntimeBridge(() => {});

	await t.throwsAsync(bridge.handleClientEvent(userMessage('turn-1')), {
		message: 'Nanocoder runtime is still starting.',
	});
});

test('web runtime bridge accepts one browser turn without waiting for completion', async t => {
	const submittedMessages: string[] = [];
	let resolveSubmission: (() => void) | undefined;
	const submission = new Promise<void>(resolve => {
		resolveSubmission = resolve;
	});
	const bridge = createWebRuntimeBridge(() => {});
	bridge.bindRuntimeHandlers({
		submitMessage: text => {
			submittedMessages.push(text);
			return submission;
		},
		cancel: () => {},
	});

	await bridge.handleClientEvent(userMessage('turn-1', 'from browser'));

	t.deepEqual(submittedMessages, ['from browser']);
	await t.throwsAsync(bridge.handleClientEvent(userMessage('turn-2')), {
		message: 'Nanocoder is already processing a browser turn.',
	});

	resolveSubmission?.();
	await submission;
});

test('web runtime bridge publishes assistant deltas and completion for the active turn', async t => {
	const events: WebServerEvent[] = [];
	let resolveSubmission: (() => void) | undefined;
	const submission = new Promise<void>(resolve => {
		resolveSubmission = resolve;
	});
	const bridge = createWebRuntimeBridge(event => {
		events.push(event);
	});
	bridge.bindRuntimeHandlers({
		submitMessage: () => submission,
		cancel: () => {},
	});

	await bridge.handleClientEvent(userMessage('turn-1'));
	bridge.publishAssistantContent('Hel');
	bridge.publishAssistantContent('Hello');
	bridge.publishAssistantContent('');
	bridge.publishAssistantContent('Again');
	bridge.completeTurn();

	t.deepEqual(events, [
		{type: 'assistant_delta', id: 'turn-1', text: 'Hel'},
		{type: 'assistant_delta', id: 'turn-1', text: 'lo'},
		{type: 'assistant_delta', id: 'turn-1', text: 'Again'},
		{type: 'turn_completed', id: 'turn-1'},
	]);

	resolveSubmission?.();
	await submission;
	t.is(events.length, 4);
});

test('web runtime bridge cancels only the matching active browser turn', async t => {
	let cancelCount = 0;
	const bridge = createWebRuntimeBridge(() => {});
	bridge.bindRuntimeHandlers({
		submitMessage: () => new Promise<void>(() => {}),
		cancel: () => {
			cancelCount++;
		},
	});

	await bridge.handleClientEvent(userMessage('turn-1'));
	await t.throwsAsync(
		bridge.handleClientEvent({type: 'cancel', id: 'turn-2'}),
		{message: 'This browser turn is no longer active.'},
	);
	await bridge.handleClientEvent({type: 'cancel', id: 'turn-1'});

	t.is(cancelCount, 1);
});

test('web runtime bridge reports asynchronous submission failures and clears the turn', async t => {
	const events: WebServerEvent[] = [];
	const submittedMessages: string[] = [];
	const bridge = createWebRuntimeBridge(event => {
		events.push(event);
	});
	bridge.bindRuntimeHandlers({
		submitMessage: async text => {
			submittedMessages.push(text);
			if (text === 'fail') {
				throw new Error('Model request failed.');
			}
		},
		cancel: () => {},
	});

	await bridge.handleClientEvent(userMessage('turn-1', 'fail'));
	await new Promise(resolve => setTimeout(resolve, 0));
	await bridge.handleClientEvent(userMessage('turn-2', 'retry'));
	await new Promise(resolve => setTimeout(resolve, 0));

	t.deepEqual(submittedMessages, ['fail', 'retry']);
	t.deepEqual(events, [
		{type: 'error', message: 'Model request failed.'},
		{type: 'turn_completed', id: 'turn-2'},
	]);
});

test('web runtime bridge cleanup does not remove a newer handler binding', async t => {
	const submittedMessages: string[] = [];
	const bridge = createWebRuntimeBridge(() => {});
	const releaseFirstBinding = bridge.bindRuntimeHandlers({
		submitMessage: text => {
			submittedMessages.push(`first:${text}`);
		},
		cancel: () => {},
	});
	bridge.bindRuntimeHandlers({
		submitMessage: text => {
			submittedMessages.push(`second:${text}`);
		},
		cancel: () => {},
	});

	releaseFirstBinding();
	await bridge.handleClientEvent(userMessage('turn-1', 'hello'));
	await new Promise(resolve => setTimeout(resolve, 0));

	t.deepEqual(submittedMessages, ['second:hello']);
});
