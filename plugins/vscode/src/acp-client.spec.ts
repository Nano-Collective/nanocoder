import test from 'ava';
import * as vscode from 'vscode';
import {isVsCodeClient} from '../../../source/acp/acp-capabilities';
import { NanocoderAcpClient } from './acp-client';
import { AcpStateManager } from './acp-state';

test('NanocoderAcpClient - permission flow', async (t) => {
	const outputChannel = { appendLine: () => {} } as any;
	const stateManager = new AcpStateManager();
	const client = new NanocoderAcpClient(outputChannel, stateManager);

	let requestedToolCallId = '';
	client.onPermissionRequested = (toolCallId) => {
		requestedToolCallId = toolCallId;
	};

	// Mock incoming permission request from ACP
	const mockToolCall = { toolCallId: 'call_123', name: 'test_tool', arguments: {} };
	
	// Start the async request, it should pend
	const requestPromise = client.handlePermissionRequest({ toolCall: mockToolCall });

	t.is(requestedToolCallId, 'call_123', 'Should emit onPermissionRequested');
	t.true(client.hasPendingPermissions(), 'Should have pending permissions');

	// Resolve the permission
	client.resolvePermission('call_123', true);

	const result = await requestPromise;
	t.is((result as any).outcome.optionId, 'allow');
	t.false(client.hasPendingPermissions(), 'Pending permissions should be cleared');
});

test('NanocoderAcpClient - forwards background title notifications', async (t) => {
	const client = makeClient({});
	let notified = false;
	client.onSessionTitleChanged = () => {
		notified = true;
	};

	await client.handleExtNotification('_nanocoder/sessionTitleChanged', {
		sessionId: 'session-1',
		title: 'Updated title',
	});

	t.true(notified);
});

function makeClient(connection: unknown) {
	const outputChannel = { appendLine: () => {} } as any;
	const client = new NanocoderAcpClient(outputChannel, new AcpStateManager());
	client.setConnection(connection as any);
	// setConnection drops the session id; restore one or the guards short-circuit.
	(client as any)._sessionId = 'session-1';
	return client;
}

test('NanocoderAcpClient - cancel resolves and clears pending permissions', async (t) => {
	const client = makeClient({ cancel: async () => {} });

	let cancelledIds: string[] = [];
	client.onPermissionsCancelled = (ids) => {
		cancelledIds = ids;
	};

	const requestPromise = client.handlePermissionRequest({
		toolCall: { toolCallId: 'call_123', name: 'write_file', arguments: {} },
	});

	t.true(client.hasPendingPermissions());

	await client.cancel();

	const result = await requestPromise;
	t.is((result as any).outcome.outcome, 'cancelled', 'Agent expects a cancelled outcome');
	t.false(
		client.hasPendingPermissions(),
		'A stale resolver would block every later message with "Please approve or deny the pending tool"',
	);
	t.deepEqual(cancelledIds, ['call_123'], 'UI needs the ids to dismiss their cards');
});

test('NanocoderAcpClient - newChat clears pending permissions', async (t) => {
	const client = makeClient({ cancel: async () => {} });

	const requestPromise = client.handlePermissionRequest({
		toolCall: { toolCallId: 'call_456', name: 'bash', arguments: {} },
	});
	t.true(client.hasPendingPermissions());

	client.newChat();

	const result = await requestPromise;
	t.is((result as any).outcome.outcome, 'cancelled');
	t.false(client.hasPendingPermissions(), 'Abandoning the chat abandons its approval prompts');
});

async function makeHandshakenClient(
	agentCapabilities: unknown,
	closeSession: (params: {sessionId: string}) => Promise<unknown>,
	extMethod?: (method: string, params: unknown) => Promise<unknown>,
) {
	const lines: string[] = [];
	const client = new NanocoderAcpClient(
		{appendLine: (line: string) => lines.push(line)} as any,
		new AcpStateManager(),
	);
	client.setConnection({
		initialize: async () => ({agentInfo: {version: '1.32.0'}, agentCapabilities}),
		closeSession,
		extMethod,
	} as any);
	await client.initializeHandshake();
	(client as any)._sessionId = 'session-old';
	return {client, lines};
}

test('NanocoderAcpClient - newChat closes the old session when the agent supports it', async (t) => {
	const closed: string[] = [];
	const {client} = await makeHandshakenClient(
		{sessionCapabilities: {close: {}}},
		async ({sessionId}) => {
			closed.push(sessionId);
			return {};
		},
	);

	client.newChat();

	t.deepEqual(closed, ['session-old']);
	t.is((client as any)._sessionId, undefined);
});

test('NanocoderAcpClient - newChat does not send session/close without the capability', async (t) => {
	let calls = 0;
	const {client} = await makeHandshakenClient({}, async () => {
		calls++;
		return {};
	});

	client.newChat();

	t.is(calls, 0);
});

test('NanocoderAcpClient - newChat logs a failed session/close instead of throwing', async (t) => {
	const {client, lines} = await makeHandshakenClient(
		{sessionCapabilities: {close: {}}},
		async () => {
			throw new Error('agent gone');
		},
	);

	t.notThrows(() => client.newChat());
	await new Promise(resolve => setImmediate(resolve));

	t.true(lines.some(line => line.includes('Failed to close session session-old: Error: agent gone')));
});

test('NanocoderAcpClient - newChat with no session sends no session/close', async (t) => {
	let calls = 0;
	const {client} = await makeHandshakenClient(
		{sessionCapabilities: {close: {}}},
		async () => {
			calls++;
			return {};
		},
	);
	(client as any)._sessionId = undefined;

	client.newChat();

	t.is(calls, 0);
});

test('NanocoderAcpClient - a cancelled prompt does not raise an error toast', async (t) => {
	let rejectPrompt: (error: Error) => void = () => {};
	const client = makeClient({
		prompt: () => new Promise((_resolve, reject) => { rejectPrompt = reject; }),
		cancel: async () => {},
	});

	const originalShowErrorMessage = vscode.window.showErrorMessage;
	let shownError: string | undefined;
	(vscode.window as any).showErrorMessage = (message: string) => {
		shownError = message;
	};
	t.teardown(() => {
		(vscode.window as any).showErrorMessage = originalShowErrorMessage;
	});

	const promptPromise = client.prompt('hello');

	// Cancel mid-flight, then the agent tears the stream down and prompt rejects.
	await client.cancel();
	rejectPrompt(new Error('Operation was cancelled'));
	const cancelledResult = await promptPromise;

	t.is(shownError, undefined, 'Cancelling is not a failure the user needs to be told about');
	t.is(cancelledResult?.stopReason, 'cancelled', 'The webview needs the cancelled terminal state');

	// The flag must not leak into the next turn, or a real failure goes unreported.
	rejectPrompt = () => {};
	const secondPrompt = client.prompt('hello again');
	rejectPrompt(new Error('RequestError: Internal error (500)'));
	await secondPrompt;

	t.regex(shownError ?? '', /RequestError/, 'A genuine failure must still surface');
});


test('NanocoderAcpClient - reconnecting clears permissions left by the dead process', async (t) => {
	const outputChannel = {appendLine: () => {}} as any;
	const stateManager = new AcpStateManager();
	const client = new NanocoderAcpClient(outputChannel, stateManager);

	const requestPromise = client.handlePermissionRequest({
		toolCall: {toolCallId: 'call_456', name: 'test_tool', arguments: {}},
	});

	client.setConnection({} as any);

	const result = await requestPromise;
	t.is((result as any).outcome.outcome, 'cancelled');
	t.false(client.hasPendingPermissions());
});
test('NanocoderAcpClient - concurrent getOrCreateSession calls share a single newSession', async (t) => {
	const outputChannel = {appendLine: () => {}} as any;
	const stateManager = new AcpStateManager();
	const client = new NanocoderAcpClient(outputChannel, stateManager);

	let newSessionCalls = 0;
	let releaseNewSession!: (value: {sessionId: string; modes?: any; configOptions?: any; _meta?: any}) => void;
	client.setConnection({
		newSession: () => {
			newSessionCalls++;
			return new Promise<any>(resolve => {
				releaseNewSession = resolve;
			});
		},
	} as any);

	const a = client.getOrCreateSession('/cwd');
	const b = client.getOrCreateSession('/cwd');
	const c = client.getOrCreateSession('/cwd');

	t.is(
		newSessionCalls,
		1,
		'overlapping getOrCreateSession() callers must coalesce into a single newSession() call against the shared connection',
	);

	releaseNewSession({sessionId: 'session-1'});
	const [sa, sb, sc] = await Promise.all([a, b, c]);

	t.is(sa, 'session-1', 'first caller resolves with the session id');
	t.is(sb, 'session-1', 'second caller resolves with the same session id');
	t.is(sc, 'session-1', 'third caller resolves with the same session id');
	t.is((client as any)._pendingSession, null, 'pending session is cleared after resolution so the next call is a fresh attempt');
});

test('NanocoderAcpClient - a rejected newSession clears _pendingSession so the next call retries', async (t) => {
	const outputChannel = {appendLine: () => {}} as any;
	const stateManager = new AcpStateManager();
	const client = new NanocoderAcpClient(outputChannel, stateManager);

	let newSessionCalls = 0;
	client.setConnection({
		newSession: () => {
			newSessionCalls++;
			return Promise.reject(new Error('backend down'));
		},
	} as any);

	// Overlapping callers must share the rejected promise - none of them should
	// spin up their own newSession retry while the first one is still in flight.
	const a = client.getOrCreateSession('/cwd');
	const b = client.getOrCreateSession('/cwd');
	const c = client.getOrCreateSession('/cwd');

	t.is(newSessionCalls, 1, 'overlapping callers must share a single in-flight newSession even when it will reject');

	const [ra, rb, rc] = await Promise.all([a, b, c]);

	t.is(ra, undefined, 'first caller resolves with undefined on rejection');
	t.is(rb, undefined, 'second caller resolves with undefined on rejection');
	t.is(rc, undefined, 'third caller resolves with undefined on rejection');
	t.is(
		(client as any)._pendingSession,
		null,
		'_pendingSession is cleared in the finally block even when the promise rejects',
	);
	t.is((client as any)._sessionId, undefined, '_sessionId must not be set when newSession rejects');

	// The regression the finally block is guarding against: a second call after
	// rejection must issue a fresh newSession, not reuse the cached rejected
	// promise (which would make every subsequent prompt fail forever).
	const next = await client.getOrCreateSession('/cwd');
	t.is(newSessionCalls, 2, 'a follow-up call after rejection must issue a fresh newSession, proving finally cleared the cache');
	t.is(next, undefined, 'follow-up call still resolves to undefined on rejection, but only because it actually tried');
});
test('NanocoderAcpClient - failed resumeSession does not leave a stale _sessionId', async (t) => {
	const originalShowError = vscode.window.showErrorMessage;
	let toasts = 0;
	(vscode.window as any).showErrorMessage = () => {
		toasts++;
		return Promise.resolve(undefined);
	};
	t.teardown(() => {
		(vscode.window as any).showErrorMessage = originalShowError;
	});

	const outputChannel = {appendLine: () => {}} as any;
	const stateManager = new AcpStateManager();
	const client = new NanocoderAcpClient(outputChannel, stateManager);
	client.setConnection({
		resumeSession: () => Promise.reject(new Error('session not found')),
	} as any);

	await client.resumeSession('session-bogus');

	t.is(
		(client as any)._sessionId,
		undefined,
		'_sessionId must not be set when resumeSession throws; otherwise getOrCreateSession returns it and every subsequent prompt hangs',
	);
	t.is(toasts, 1, 'a real failure must still surface as an error toast');
});

test('NanocoderAcpClient - handshake is incomplete until initialize succeeds', async (t) => {
	const outputChannel = {appendLine: () => {}} as any;
	const client = new NanocoderAcpClient(outputChannel, new AcpStateManager());
	t.false(client.isHandshakeComplete);

	client.setConnection({
		initialize: async () => ({agentInfo: {version: '1.29.0'}}),
	} as any);
	t.false(client.isHandshakeComplete, 'stdio attached is not a completed handshake');

	const ok = await client.initializeHandshake();
	t.true(ok);
	t.true(client.isHandshakeComplete);

	client.setConnection({initialize: async () => ({agentInfo: {version: '1.29.0'}})} as any);
	t.false(client.isHandshakeComplete, 'A new connection must re-handshake');
});

test('NanocoderAcpClient - the handshake identifies it as the client the agent treats as VS Code', async (t) => {
	let clientInfo: {name: string} | undefined;
	const client = new NanocoderAcpClient({appendLine: () => {}} as any, new AcpStateManager());
	client.setConnection({
		initialize: async (params: {clientInfo?: {name: string}}) => {
			clientInfo = params.clientInfo;
			return {agentInfo: {version: '1.29.0'}};
		},
	} as any);

	await client.initializeHandshake();

	t.true(isVsCodeClient(clientInfo));
});

/**
 * A connection whose newSession() calls stay pending until released, in call
 * order, so a test can act (New Chat, resume, reconnect) while one is in flight.
 * Records every setSessionMode call so a test can see which session it hit.
 */
function makeSlowSessionConnection() {
	const releases: Array<(sessionId: string) => void> = [];
	const modeCalls: string[] = [];
	const connection = {
		newSession: () =>
			new Promise<any>(resolve => {
				releases.push(sessionId =>
					resolve({
						sessionId,
						modes: {
							currentModeId: 'normal',
							availableModes: [{id: 'normal'}, {id: 'auto-accept'}],
						},
						_meta: {sessionId},
					}),
				);
			}),
		setSessionMode: async ({sessionId}: {sessionId: string}) => {
			modeCalls.push(sessionId);
		},
		resumeSession: async () => ({}),
	};
	return {connection, releases, modeCalls};
}

function makeConnectedClient(connection: unknown) {
	const client = new NanocoderAcpClient(
		{appendLine: () => {}} as any,
		new AcpStateManager(),
	);
	client.setConnection(connection as any);
	(client as any)._handshakeComplete = true;
	return client;
}

/** Let pending promise callbacks run. */
const settle = () => new Promise(resolve => setImmediate(resolve));

test('NanocoderAcpClient - New Chat during session creation discards the abandoned session', async (t) => {
	const {connection, releases, modeCalls} = makeSlowSessionConnection();
	const client = makeConnectedClient(connection);
	const artifacts: unknown[] = [];
	client.onSessionArtifacts = meta => artifacts.push(meta);

	const pending = client.getOrCreateSession('/cwd');
	client.newChat();

	releases[0]?.('session-abandoned');
	await settle();
	t.is(releases.length, 2, 'the caller waiting across New Chat asks for a fresh session');
	releases[1]?.('session-fresh');

	t.is(await pending, 'session-fresh');
	t.is((client as any)._sessionId, 'session-fresh');
	t.false(
		modeCalls.includes('session-abandoned'),
		'the abandoned session must not be configured after New Chat',
	);
	t.false(
		artifacts.some(meta => (meta as any)?.sessionId === 'session-abandoned'),
		"the abandoned session's artifacts must not reach the UI",
	);
});

test('NanocoderAcpClient - a session request after New Chat does not join the abandoned creation', async (t) => {
	const {connection, releases} = makeSlowSessionConnection();
	const client = makeConnectedClient(connection);

	const beforeNewChat = client.getOrCreateSession('/cwd');
	client.newChat();
	const afterNewChat = client.getOrCreateSession('/cwd');

	t.is(releases.length, 2, 'a request after New Chat starts its own newSession');
	releases[0]?.('session-abandoned');
	releases[1]?.('session-fresh');

	t.deepEqual(await Promise.all([beforeNewChat, afterNewChat]), [
		'session-fresh',
		'session-fresh',
	]);
	t.is(releases.length, 2, 'both callers share the one fresh session');
});

test('NanocoderAcpClient - a creation still in flight when the process reconnects is discarded', async (t) => {
	const {connection, releases} = makeSlowSessionConnection();
	const client = makeConnectedClient(connection);

	const pending = client.getOrCreateSession('/cwd');
	client.setConnection(makeSlowSessionConnection().connection as any);
	releases[0]?.('session-from-dead-process');

	t.is(await pending, undefined, 'the new process re-creates its session after the handshake');
	t.is((client as any)._sessionId, undefined);
});

test('NanocoderAcpClient - a creation still in flight does not overwrite a resumed session', async (t) => {
	const {connection, releases} = makeSlowSessionConnection();
	const client = makeConnectedClient(connection);

	const pending = client.getOrCreateSession('/cwd');
	await client.resumeSession('session-resumed');
	releases[0]?.('session-created');

	t.is(await pending, 'session-resumed');
	t.is((client as any)._sessionId, 'session-resumed');
});

function recordExtCalls() {
	const calls: Array<{method: string; params: unknown}> = [];
	const extMethod = async (method: string, params: unknown) => {
		calls.push({method, params});
		return {};
	};
	return {calls, extMethod};
}

async function renameAndRetry(agentCapabilities: unknown) {
	const {calls, extMethod} = recordExtCalls();
	const {client} = await makeHandshakenClient(
		agentCapabilities,
		async () => ({}),
		extMethod,
	);
	await client.renameSession('session-old', 'New title');
	await client.retryTurn('again');
	return {client, calls};
}

test('NanocoderAcpClient - rename and retry use the extension names the agent advertises', async (t) => {
	const {calls} = await renameAndRetry({
		_meta: {
			nanocoder: {
				extMethods: ['_nanocoder/renameSession', '_nanocoder/retryTurn'],
			},
		},
	});

	t.deepEqual(
		calls.map((call) => call.method),
		['_nanocoder/renameSession', '_nanocoder/retryTurn'],
	);
	t.deepEqual(calls[0].params, {sessionId: 'session-old', title: 'New title'});
});

test('NanocoderAcpClient - rename and retry fall back to the bare names for an agent that advertises none', async (t) => {
	for (const agentCapabilities of [
		{},
		{_meta: {nanocoder: {}}},
		{_meta: {nanocoder: {extMethods: 'x'}}},
	]) {
		const {calls} = await renameAndRetry(agentCapabilities);

		t.deepEqual(
			calls.map((call) => call.method),
			['renameSession', 'retryTurn'],
		);
	}
});

test('NanocoderAcpClient - each extension method resolves on its own against what the agent advertises', async (t) => {
	const {calls} = await renameAndRetry({
		_meta: {nanocoder: {extMethods: ['_nanocoder/renameSession']}},
	});

	t.deepEqual(
		calls.map((call) => call.method),
		['_nanocoder/renameSession', 'retryTurn'],
	);
});
