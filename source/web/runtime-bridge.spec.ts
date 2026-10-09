import test from 'ava';
import type {WebServerEvent} from './protocol.js';
import {createWebRuntimeBridge} from './runtime-bridge.js';
import type {WebRuntimeHandlers} from './runtime-bridge.js';

const handlers = (overrides: Partial<WebRuntimeHandlers> = {}): WebRuntimeHandlers => ({
	submitMessage: () => new Promise<void>(() => {}),
	cancel: () => {}, resetSession: () => {}, listSessions: async () => [],
	loadSession: async () => null, deleteSession: async () => {}, ...overrides,
});

const userMessage = (id: string, text = 'hello') => ({
	type: 'user_message' as const,
	id,
	text,
});

test('older session-list responses cannot overwrite a newer runtime refresh', async t => {
	const events: WebServerEvent[] = [];
	const pending: ((sessions: import('./protocol.js').WebSessionSummary[]) => void)[] = [];
	const bridge = createWebRuntimeBridge(event => events.push(event));
	bridge.bindRuntimeHandlers(handlers({listSessions: () => new Promise(resolve => pending.push(resolve))}));
	const old = bridge.handleClientEvent({type: 'list_sessions', id: 'old'});
	const fresh = bridge.refreshSessions();
	pending[1]([{id: 'session', title: 'New title', lastAccessedAt: '', messageCount: 2}]);
	await fresh;
	pending[0]([{id: 'session', title: 'Old title', lastAccessedAt: '', messageCount: 1}]);
	await old;
	t.deepEqual(events.filter(event => event.type === 'sessions').map(event => event.sessions[0].title), ['New title']);
});

test('workspace panels remain available during a turn without submitting or cancelling it', async t => {
	const events: WebServerEvent[] = [];
	const bridge = createWebRuntimeBridge(event => events.push(event));
	bridge.bindRuntimeHandlers(handlers({getWorkspacePanel: async panel => ({panel, items: [{name: 'Current task'}]})}));
	await bridge.handleClientEvent(userMessage('turn'));
	await bridge.handleClientEvent({type: 'workspace_panel', id: 'tasks', panel: 'tasks'});
	t.true(bridge.hasActiveBrowserTurn());
	t.true(events.some(event => event.type === 'workspace_panel' && event.id === 'tasks' && event.data.items[0].name === 'Current task'));
});

test('empty cleaned tool text is removed and only the final finished reply gets a footer', async t => {
	const events: WebServerEvent[] = [];
	const bridge = createWebRuntimeBridge(event => events.push(event));
	bridge.bindRuntimeHandlers(handlers());
	await bridge.handleClientEvent(userMessage('turn'));
	bridge.publishAssistantContent('<tool_call>read_file</tool_call>');
	bridge.publishAssistantContent('');
	t.true(events.some(event => event.type === 'assistant_content' && event.text === ''));
	t.like(bridge.getStateEvents()[0], {messages: [{role: 'user'}]});
	bridge.publishAssistantContent('Checking files');
	bridge.publishAssistantContent('', true);
	bridge.publishAssistantContent('Done');
	t.like(bridge.getStateEvents()[0], {messages: [{role: 'user'}, {footerVisible: false}, {footerVisible: false}]});
	bridge.completeTurn();
	t.like(bridge.getStateEvents()[0], {messages: [{role: 'user'}, {footerVisible: false}, {footerVisible: true}]});
});

test('completion and delayed history commits cannot remove or shorten the streamed reply', async t => {
	const bridge = createWebRuntimeBridge(() => {});
	bridge.bindRuntimeHandlers(handlers({getSessionState: () => ({session: null, messages: []})}));
	await bridge.handleClientEvent(userMessage('turn'));
	bridge.publishAssistantContent('Hello world');
	bridge.completeTurn();
	t.like(bridge.getStateEvents()[0], {messages: [{id: 'turn', role: 'user'}, {id: 'turn', role: 'assistant', content: 'Hello world'}]});
	bridge.syncSession(null, [{role: 'user', content: 'hello'}, {role: 'assistant', content: 'Hello'}]);
	t.like(bridge.getStateEvents()[0], {messages: [{id: 'turn', role: 'user'}, {id: 'turn', role: 'assistant', content: 'Hello world'}]});
});

test('reasoning snapshots retain multiple model steps and tool results', async t => {
	const bridge = createWebRuntimeBridge(() => {});
	bridge.bindRuntimeHandlers(handlers());
	await bridge.handleClientEvent(userMessage('turn'));
	bridge.publishReasoning('First thought');
	bridge.publishReasoning('');
	bridge.publishReasoning('Second thought');
	bridge.publishToolStarted('read', 'read_file', {path: 'README.md'});
	bridge.publishToolFinished('read', 'read_file', true, 'Contents');
	bridge.completeTurn();
	t.like(bridge.getStateEvents()[0], {work: [{status: 'completed', reasoning: [{text: 'First thought'}, {text: 'Second thought'}], tools: [{id: 'read', status: 'completed', output: 'Contents'}]}]});
});

test('authoritative runtime snapshots restore resumed history and track autosaved sessions for deletion', async t => {
	const bridge = createWebRuntimeBridge(() => {});
	let snapshot = {session: {id: 'resumed', title: 'Resumed chat', lastAccessedAt: '2026-01-01', messageCount: 1}, messages: [{role: 'user' as const, content: 'existing history'}]};
	let resets = 0;
	bridge.bindRuntimeHandlers(handlers({
		getSessionState: () => snapshot,
		resetSession: () => {resets++;},
	}));
	t.like(bridge.getStateEvents()[0], {runtimeReady: true, session: {id: 'resumed'}, messages: [{role: 'user', content: 'existing history'}]});
	snapshot = {...snapshot, session: {...snapshot.session, id: 'autosaved'}};
	await bridge.handleClientEvent({type: 'delete_session', id: 'delete', sessionId: 'autosaved'});
	t.is(resets, 1);
	t.like(bridge.getStateEvents()[0], {session: null, messages: []});
});

test('turn completion and slash clear reconcile the authoritative runtime transcript', async t => {
	const bridge = createWebRuntimeBridge(() => {});
	let history = [{role: 'user' as const, content: 'old prompt'}];
	bridge.bindRuntimeHandlers(handlers({
		getSessionState: () => ({session: null, messages: history}),
		submitMessage: async () => {history = [];},
	}));
	await bridge.handleClientEvent(userMessage('clear', '/clear'));
	await new Promise(resolve => setImmediate(resolve));
	t.like(bridge.getStateEvents()[0], {activeTurnId: null, messages: []});
});

test('runtime startup status and settings failures release the browser lock', async t => {
	const bridge = createWebRuntimeBridge(() => {});
	bridge.setRuntimeStatus('Approve directory trust in the terminal.');
	await t.throwsAsync(bridge.handleClientEvent(userMessage('wait')), {message: 'Approve directory trust in the terminal.'});
	bridge.bindRuntimeHandlers(handlers({updateSettings: async () => {throw new Error('Provider unavailable');}}));
	await t.throwsAsync(bridge.handleClientEvent({type: 'update_settings', id: 'settings', provider: 'local', model: 'small', mode: 'normal'}), {message: 'Provider unavailable'});
	t.like(bridge.getStateEvents()[0], {busy: false, runtimeReady: true});
});

test('reconnect snapshots retain tool failures and provider errors', async t => {
	const bridge = createWebRuntimeBridge(() => {});
	bridge.bindRuntimeHandlers(handlers());
	await bridge.handleClientEvent(userMessage('turn'));
	bridge.publishToolFinished('tool', 'write_file', false);
	bridge.failTurn(new Error('Provider failed'));
	t.like(bridge.getStateEvents()[0], {notices: [{role: 'system error', text: 'Provider failed'}], work: [{status: 'failed', tools: [{id: 'tool', name: 'write_file', status: 'failed'}]}]});
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
	bridge.publishAssistantContent('', true);
	bridge.publishAssistantContent('Again');
	bridge.completeTurn();

	t.deepEqual(events.filter(event => event.type !== 'state'), [
		{type: 'assistant_delta', id: 'turn-1', text: 'Hel'},
		{type: 'assistant_delta', id: 'turn-1', text: 'lo'},
		{type: 'assistant_delta', id: 'turn-1:response:2', text: 'Again'},
		{type: 'turn_completed', id: 'turn-1'},
	]);

	resolveSubmission?.();
	await submission;
	t.is(events.filter(event => event.type !== 'state').length, 4);
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
	t.deepEqual(events.filter(event => event.type !== 'state'), [
		{type: 'error', id: 'turn-1', message: 'Model request failed.'},
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
	t.deepEqual(events.filter(event => event.type !== 'state'), []);

	await bridge.handleClientEvent(userMessage('turn-1'));
	bridge.publishToolStarted('tool-1', 'read_file');
	bridge.publishToolFinished('tool-1', 'read_file', true);

	t.deepEqual(events.filter(event => event.type !== 'state'), [
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

	t.deepEqual(events.filter(event => event.type !== 'state'), [
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
	t.deepEqual(events.filter(event => event.type !== 'state'), [
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

test('concurrent approvals and questions are presented FIFO across slots', async t => {
	const events: WebServerEvent[] = [];
	const bridge = createWebRuntimeBridge(event => events.push(event));
	bridge.bindRuntimeHandlers(handlers());
	await bridge.handleClientEvent(userMessage('turn'));
	const first = bridge.requestApproval({toolName: 'first', arguments: {}});
	const second = bridge.requestApproval({toolName: 'second', arguments: {}});
	const question = bridge.requestQuestion({question: 'Which?', options: ['A', 'B'], allowFreeform: false});
	t.is(events.filter(event => event.type === 'approval_required').length, 1);
	const firstEvent = events.at(-1)!;
	await bridge.handleClientEvent({type: 'approval_response', id: firstEvent.id!, approved: true});
	t.true(await first);
	t.like(events.at(-1), {type: 'approval_required', toolName: 'second'});
	await bridge.handleClientEvent({type: 'approval_response', id: events.at(-1)!.id!, approved: false});
	t.false(await second);
	t.like(events.at(-1), {type: 'question_required', question: 'Which?'});
	await bridge.handleClientEvent({type: 'question_response', id: events.at(-1)!.id!, answer: 'B'});
	t.is(await question, 'B');
});

test('aborting browser interactions denies them and removes stale responses', async t => {
	const events: WebServerEvent[] = [];
	const bridge = createWebRuntimeBridge(event => events.push(event));
	bridge.bindRuntimeHandlers(handlers());
	await bridge.handleClientEvent(userMessage('turn'));
	const controller = new AbortController();
	const approval = bridge.requestApproval({toolName: 'first', arguments: {}}, controller.signal);
	const id = events.at(-1)!.id!;
	const queuedController = new AbortController();
	const queued = bridge.requestQuestion({question: 'queued', options: [], allowFreeform: true}, queuedController.signal);
	queuedController.abort();
	t.regex(await queued, /cancelled/);
	controller.abort();
	t.false(await approval);
	await t.throwsAsync(bridge.handleClientEvent({type: 'approval_response', id, approved: true}));
	t.is(bridge.getStateEvents().length, 1);
});

test('reconnect snapshots include the active prompt, full replies, images and pending interaction', async t => {
	const bridge = createWebRuntimeBridge(() => {});
	bridge.bindRuntimeHandlers(handlers());
	const images = [{data: 'data:image/png;base64,AA==', mediaType: 'image/png'}];
	await bridge.handleClientEvent({...userMessage('turn'), images});
	bridge.publishAssistantContent('Hello');
	bridge.publishAssistantContent('Hello world');
	const approval = bridge.requestApproval({toolName: 'write_file', arguments: {}});
	const snapshot = bridge.getStateEvents();
	t.like(snapshot[0], {type: 'state', activeTurnId: 'turn', messages: [
		{id: 'turn', role: 'user', content: 'hello', images},
		{id: 'turn', role: 'assistant', content: 'Hello world'},
	]});
	t.like(snapshot[1], {type: 'approval_required', toolName: 'write_file'});
	bridge.publishAssistantContent('Corrected');
	t.like(snapshot[0], {messages: [{content: 'hello'}, {content: 'Hello world'}]});
	bridge.completeTurn();
	t.false(await approval);
	t.like(bridge.getStateEvents()[0], {activeTurnId: null, messages: [{content: 'hello'}, {content: 'Corrected'}]});
});

test('session operations lock out prompts and release the lock on failure', async t => {
	let release!: () => void;
	const loading = new Promise<void>(resolve => {release = resolve;});
	const bridge = createWebRuntimeBridge(() => {});
	bridge.bindRuntimeHandlers(handlers({loadSession: async () => {await loading; throw new Error('load failed');}}));
	const load = bridge.handleClientEvent({type: 'load_session', id: 'load', sessionId: 'saved'});
	await t.throwsAsync(bridge.handleClientEvent(userMessage('turn')), {message: 'A session operation is already in progress.'});
	t.like(bridge.getStateEvents()[0], {busy: true});
	release();
	await t.throwsAsync(load, {message: 'load failed'});
	t.like(bridge.getStateEvents()[0], {busy: false});
	await t.notThrowsAsync(bridge.handleClientEvent(userMessage('retry')));
});

test('failed reset preserves the transcript and deleting the active session resets it first', async t => {
	const bridge = createWebRuntimeBridge(() => {});
	const sequence: string[] = [];
	const session = {id: 'saved', title: 'Saved', lastAccessedAt: '', messageCount: 1};
	bridge.bindRuntimeHandlers(handlers({
		loadSession: async () => ({session, messages: [{role: 'user', content: 'keep me'}]}),
		resetSession: async () => {throw new Error('reset failed');},
	}));
	await bridge.handleClientEvent({type: 'load_session', id: 'load', sessionId: 'saved'});
	await t.throwsAsync(bridge.handleClientEvent({type: 'reset_session', id: 'reset'}));
	t.like(bridge.getStateEvents()[0], {session, messages: [{content: 'keep me'}]});
	bridge.bindRuntimeHandlers(handlers({resetSession: () => {sequence.push('reset');}, deleteSession: async () => {sequence.push('delete');}}));
	await bridge.handleClientEvent({type: 'delete_session', id: 'delete', sessionId: 'saved'});
	t.deepEqual(sequence, ['reset', 'delete']);
	t.like(bridge.getStateEvents()[0], {session: null, messages: []});
});
