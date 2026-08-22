import test from 'ava';
import * as vscode from 'vscode';
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
	await promptPromise;

	t.is(shownError, undefined, 'Cancelling is not a failure the user needs to be told about');

	// The flag must not leak into the next turn, or a real failure goes unreported.
	rejectPrompt = () => {};
	const secondPrompt = client.prompt('hello again');
	rejectPrompt(new Error('RequestError: Internal error (500)'));
	await secondPrompt;

	t.regex(shownError ?? '', /RequestError/, 'A genuine failure must still surface');
});

test('NanocoderAcpClient - listTimeline returns entries from extMethod', async (t) => {
	const client = makeClient({
		extMethod: async (method: string, params: Record<string, unknown>) => {
			t.is(method, 'timeline/list');
			t.is(params.sessionId, 'session-1');
			return {
				entries: [
					{
						id: 'cp-1',
						seq: 1,
						toolCallId: 'call-1',
						toolName: 'write_file',
						title: 'write_file: a.ts',
						timestamp: '2026-01-01T00:00:00.000Z',
						filesChanged: ['a.ts'],
					},
				],
			};
		},
	});

	const entries = await client.listTimeline();
	t.is(entries.length, 1);
	t.is(entries[0].id, 'cp-1');
});

test('NanocoderAcpClient - revertTimeline calls timeline/revert', async (t) => {
	let called: {method?: string; params?: Record<string, unknown>} = {};
	const client = makeClient({
		extMethod: async (method: string, params: Record<string, unknown>) => {
			called = {method, params};
			return {revertedTo: {id: 'cp-1'}, filesRestored: ['a.ts']};
		},
	});

	await client.revertTimeline('cp-1');
	t.is(called.method, 'timeline/revert');
	t.deepEqual(called.params, {sessionId: 'session-1', checkpointId: 'cp-1'});
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
