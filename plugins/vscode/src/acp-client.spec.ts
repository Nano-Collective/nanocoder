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
