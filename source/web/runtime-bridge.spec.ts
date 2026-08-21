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
		resetSession: () => {},
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
		resetSession: () => {},
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
		resetSession: () => {},
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
		resetSession: () => {},
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
		resetSession: () => {},
	});
	bridge.bindRuntimeHandlers({
		submitMessage: text => {
			submittedMessages.push(`second:${text}`);
		},
		cancel: () => {},
		resetSession: () => {},
	});

	releaseFirstBinding();
	await bridge.handleClientEvent(userMessage('turn-1', 'hello'));
	await new Promise(resolve => setTimeout(resolve, 0));

	t.deepEqual(submittedMessages, ['second:hello']);
});

test('web runtime bridge resolves matching approval responses during a browser turn', async t => {
	const events: WebServerEvent[] = [];
	const bridge = createWebRuntimeBridge(event => {
		events.push(event);
	});
	bridge.bindRuntimeHandlers({
		submitMessage: () => new Promise<void>(() => {}),
		cancel: () => {},
		resetSession: () => {},
	});

	await bridge.handleClientEvent(userMessage('turn-1'));
	const approvalPromise = bridge.requestApproval({
		toolName: 'write_file',
		arguments: {path: 'README.md'},
		context: 'Subagent: researcher',
	});

	t.like(events.at(-1), {
		type: 'approval_required',
		toolName: 'write_file',
		arguments: {path: 'README.md'},
		context: 'Subagent: researcher',
	});

	const approvalEvent = events.at(-1);
	if (!approvalEvent || approvalEvent.type !== 'approval_required') {
		t.fail('expected approval_required event');
		return;
	}

	await bridge.handleClientEvent({
		type: 'approval_response',
		id: approvalEvent.id,
		approved: true,
	});

	t.true(await approvalPromise);
	await t.throwsAsync(
		bridge.handleClientEvent({
			type: 'approval_response',
			id: approvalEvent.id,
			approved: false,
		}),
		{message: 'This approval response does not match a pending request.'},
	);
});

test('web runtime bridge rejects stale question responses and clears on cancel', async t => {
	const events: WebServerEvent[] = [];
	let cancelCount = 0;
	const bridge = createWebRuntimeBridge(event => {
		events.push(event);
	});
	bridge.bindRuntimeHandlers({
		submitMessage: () => new Promise<void>(() => {}),
		cancel: () => {
			cancelCount++;
		},
		resetSession: () => {},
	});

	await bridge.handleClientEvent(userMessage('turn-1'));
	const questionPromise = bridge.requestQuestion({
		question: 'Which approach?',
		options: ['A', 'B'],
		allowFreeform: true,
	});

	const questionEvent = events.at(-1);
	if (!questionEvent || questionEvent.type !== 'question_required') {
		t.fail('expected question_required event');
		return;
	}

	await t.throwsAsync(
		bridge.handleClientEvent({
			type: 'question_response',
			id: 'stale-id',
			answer: 'A',
		}),
		{message: 'This question response does not match a pending request.'},
	);

	await bridge.handleClientEvent({type: 'cancel', id: 'turn-1'});
	await t.throwsAsync(questionPromise, {
		message: 'The browser turn was cancelled before the question was answered.',
	});
	t.is(cancelCount, 1);
});

test('web runtime bridge publishes tool lifecycle only during an active browser turn', async t => {
	const events: WebServerEvent[] = [];
	const bridge = createWebRuntimeBridge(event => {
		events.push(event);
	});
	bridge.bindRuntimeHandlers({
		submitMessage: () => new Promise<void>(() => {}),
		cancel: () => {},
		resetSession: () => {},
	});

	bridge.publishToolStarted('tool-1', 'read_file');
	t.deepEqual(events, []);

	await bridge.handleClientEvent(userMessage('turn-1'));
	bridge.publishToolStarted('tool-1', 'read_file');
	bridge.publishToolFinished('tool-1', 'read_file', true);

	t.deepEqual(events, [
		{type: 'tool_started', id: 'tool-1', name: 'read_file'},
		{type: 'tool_finished', id: 'tool-1', name: 'read_file', ok: true},
	]);
});

test('web runtime bridge resets the session when no browser turn is active', async t => {
	let resetCount = 0;
	const bridge = createWebRuntimeBridge(() => {});
	bridge.bindRuntimeHandlers({
		submitMessage: () => new Promise<void>(() => {}),
		cancel: () => {},
		resetSession: () => {
			resetCount++;
		},
	});

	await bridge.handleClientEvent({type: 'reset_session', id: 'reset-1'});

	t.is(resetCount, 1);
});

test('web runtime bridge refuses to reset the session while a browser turn is active', async t => {
	let resetCount = 0;
	const bridge = createWebRuntimeBridge(() => {});
	bridge.bindRuntimeHandlers({
		submitMessage: () => new Promise<void>(() => {}),
		cancel: () => {},
		resetSession: () => {
			resetCount++;
		},
	});

	await bridge.handleClientEvent(userMessage('turn-1'));
	await t.throwsAsync(
		bridge.handleClientEvent({type: 'reset_session', id: 'reset-1'}),
		{message: 'Cannot start a new chat while a browser turn is active.'},
	);

	t.is(resetCount, 0);
});

test('web runtime bridge broadcasts the session list on list_sessions', async t => {
	const events: WebServerEvent[] = [];
	const bridge = createWebRuntimeBridge(event => events.push(event));
	bridge.bindRuntimeHandlers({
		submitMessage: () => new Promise<void>(() => {}),
		cancel: () => {},
		resetSession: () => {},
		listSessions: async () => [
			{
				id: 'session-1',
				title: 'Fix the flaky test',
				lastAccessedAt: '2026-08-01T00:00:00.000Z',
				messageCount: 4,
			},
		],
		loadSession: async () => null,
	});

	await bridge.handleClientEvent({type: 'list_sessions', id: 'list-1'});

	t.deepEqual(events, [
		{
			type: 'sessions',
			id: 'list-1',
			sessions: [
				{
					id: 'session-1',
					title: 'Fix the flaky test',
					lastAccessedAt: '2026-08-01T00:00:00.000Z',
					messageCount: 4,
				},
			],
		},
	]);
});

test('web runtime bridge broadcasts the loaded session on load_session', async t => {
	const events: WebServerEvent[] = [];
	const loadedIds: string[] = [];
	const bridge = createWebRuntimeBridge(event => events.push(event));
	bridge.bindRuntimeHandlers({
		submitMessage: () => new Promise<void>(() => {}),
		cancel: () => {},
		resetSession: () => {},
		listSessions: async () => [],
		loadSession: async sessionId => {
			loadedIds.push(sessionId);
			return {
				session: {
					id: sessionId,
					title: 'Fix the flaky test',
					lastAccessedAt: '2026-08-01T00:00:00.000Z',
					messageCount: 2,
				},
				messages: [
					{role: 'user', content: 'why is this test flaky?'},
					{role: 'assistant', content: 'it races the file watcher'},
				],
			};
		},
	});

	await bridge.handleClientEvent({
		type: 'load_session',
		id: 'load-1',
		sessionId: 'session-1',
	});

	t.deepEqual(loadedIds, ['session-1']);
	t.deepEqual(events, [
		{
			type: 'session_loaded',
			id: 'load-1',
			session: {
				id: 'session-1',
				title: 'Fix the flaky test',
				lastAccessedAt: '2026-08-01T00:00:00.000Z',
				messageCount: 2,
			},
			messages: [
				{role: 'user', content: 'why is this test flaky?'},
				{role: 'assistant', content: 'it races the file watcher'},
			],
		},
	]);
});

test('web runtime bridge rejects load_session for an unknown session', async t => {
	const bridge = createWebRuntimeBridge(() => {});
	bridge.bindRuntimeHandlers({
		submitMessage: () => new Promise<void>(() => {}),
		cancel: () => {},
		resetSession: () => {},
		listSessions: async () => [],
		loadSession: async () => null,
	});

	await t.throwsAsync(
		bridge.handleClientEvent({
			type: 'load_session',
			id: 'load-1',
			sessionId: 'missing',
		}),
		{message: 'Session not found.'},
	);
});

test('web runtime bridge refuses to switch sessions while a browser turn is active', async t => {
	const loadedIds: string[] = [];
	const bridge = createWebRuntimeBridge(() => {});
	bridge.bindRuntimeHandlers({
		submitMessage: () => new Promise<void>(() => {}),
		cancel: () => {},
		resetSession: () => {},
		listSessions: async () => [],
		loadSession: async sessionId => {
			loadedIds.push(sessionId);
			return null;
		},
	});

	await bridge.handleClientEvent(userMessage('turn-1'));
	await t.throwsAsync(
		bridge.handleClientEvent({
			type: 'load_session',
			id: 'load-1',
			sessionId: 'session-1',
		}),
		{message: 'Cannot switch sessions while a browser turn is active.'},
	);

	t.deepEqual(loadedIds, []);
});

test('web runtime bridge denies pending approval on disconnect', async t => {
	const bridge = createWebRuntimeBridge(() => {});
	bridge.bindRuntimeHandlers({
		submitMessage: () => new Promise<void>(() => {}),
		cancel: () => {},
		resetSession: () => {},
	});

	await bridge.handleClientEvent(userMessage('turn-1'));
	const approvalPromise = bridge.requestApproval({
		toolName: 'execute_bash',
		arguments: {command: 'ls'},
	});
	bridge.handleDisconnect();

	t.false(await approvalPromise);
});
