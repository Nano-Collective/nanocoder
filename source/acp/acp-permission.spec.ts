import test from 'ava';
import type {AgentSideConnection} from '@agentclientprotocol/sdk';
import {requestToolPermission} from '@/acp/acp-permission';
import {AcpSession} from '@/acp/acp-session';
import type {ToolCall} from '@/types/core';

console.log('\nacp-permission.spec.ts');

const createMockToolCall = (
	name: string,
	args: Record<string, unknown> = {},
	id = 'test-call-id',
): ToolCall => ({
	id,
	function: {name, arguments: args},
});

const createMockConn = (
	permissionResponse: any,
): AgentSideConnection =>
	({
		requestPermission: async () => permissionResponse,
	}) as unknown as AgentSideConnection;

const createTestSession = (conn: AgentSideConnection): AcpSession =>
	new AcpSession({
		sessionId: 'test-session',
		cwd: '/tmp',
		conn,
	});

// ============================================================================
// Approved
// ============================================================================

test('requestToolPermission - returns approved when user selects allow', async t => {
	const conn = createMockConn({
		outcome: {outcome: 'selected', optionId: 'allow'},
	});
	const session = createTestSession(conn);
	const toolCall = createMockToolCall('read_file');

	const result = await requestToolPermission(session, toolCall, conn);
	t.is(result, 'approved');
});

// ============================================================================
// Denied
// ============================================================================

test('requestToolPermission - returns denied when user selects deny', async t => {
	const conn = createMockConn({
		outcome: {outcome: 'selected', optionId: 'deny'},
	});
	const session = createTestSession(conn);
	const toolCall = createMockToolCall('read_file');

	const result = await requestToolPermission(session, toolCall, conn);
	t.is(result, 'denied');
});

test('requestToolPermission - returns denied for unknown option', async t => {
	const conn = createMockConn({
		outcome: {outcome: 'selected', optionId: 'other'},
	});
	const session = createTestSession(conn);
	const toolCall = createMockToolCall('read_file');

	const result = await requestToolPermission(session, toolCall, conn);
	t.is(result, 'denied');
});

// ============================================================================
// Cancelled
// ============================================================================

test('requestToolPermission - returns cancelled when user cancels', async t => {
	const conn = createMockConn({
		outcome: {outcome: 'cancelled'},
	});
	const session = createTestSession(conn);
	const toolCall = createMockToolCall('read_file');

	const result = await requestToolPermission(session, toolCall, conn);
	t.is(result, 'cancelled');
});

// ============================================================================
// Request structure
// ============================================================================

test('requestToolPermission - passes correct tool call info to conn', async t => {
	let capturedRequest: any;
	const conn = {
		requestPermission: async (req: any) => {
			capturedRequest = req;
			return {outcome: {outcome: 'selected', optionId: 'allow'}};
		},
	} as unknown as AgentSideConnection;

	const session = createTestSession(conn);
	const toolCall = createMockToolCall('execute_bash', {cmd: 'ls'}, 'call-123');

	await requestToolPermission(session, toolCall, conn);

	t.is(capturedRequest.sessionId, 'test-session');
	t.is(capturedRequest.toolCall.toolCallId, 'call-123');
	t.is(capturedRequest.toolCall.title, 'execute_bash');
	t.deepEqual(capturedRequest.toolCall.rawInput, {cmd: 'ls'});
	t.is(capturedRequest.toolCall.status, 'pending');
});

test('requestToolPermission - passes allow and deny options', async t => {
	let capturedRequest: any;
	const conn = {
		requestPermission: async (req: any) => {
			capturedRequest = req;
			return {outcome: {outcome: 'cancelled'}};
		},
	} as unknown as AgentSideConnection;

	const session = createTestSession(conn);
	const toolCall = createMockToolCall('read_file');

	await requestToolPermission(session, toolCall, conn);

	t.is(capturedRequest.options.length, 2);
	t.is(capturedRequest.options[0].optionId, 'allow');
	t.is(capturedRequest.options[0].kind, 'allow_once');
	t.is(capturedRequest.options[1].optionId, 'deny');
	t.is(capturedRequest.options[1].kind, 'reject_once');
});
