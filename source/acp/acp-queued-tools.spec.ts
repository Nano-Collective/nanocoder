import test from 'ava';
import type {AgentSideConnection} from '@agentclientprotocol/sdk';
import {AcpSession} from '@/acp/acp-session';
import {runAcpConversation} from '@/acp/acp-conversation';
import {setToolRegistryGetter, setToolManagerGetter} from '@/message-handler';
import type {LLMClient, ToolCall} from '@/types/core';

console.log('\nacp-queued-tools.spec.ts');

// ============================================================================
// Test helpers
// ============================================================================

const createMockToolCall = (
	name: string,
	args: Record<string, unknown> = {},
	id?: string,
): ToolCall => ({
	id: id ?? `call-${Math.random().toString(36).slice(2, 8)}`,
	function: {name, arguments: args},
});

const createMockConn = (): {conn: AgentSideConnection; updates: any[]} => {
	const updates: any[] = [];
	const conn = {
		sessionUpdate: async (update: any) => {
			updates.push(update);
		},
		requestPermission: async () => ({
			outcome: {outcome: 'selected', optionId: 'allow'},
		}),
	} as unknown as AgentSideConnection;
	return {conn, updates};
};

const createMockSession = (
	conn: AgentSideConnection,
	devMode: any = 'auto-accept',
): AcpSession => {
	const session = new AcpSession({
		sessionId: 'test-session',
		cwd: '/tmp',
		conn,
		initialMode: devMode,
	});
	session.messages = [];
	session.systemMessage = {role: 'system', content: 'You are helpful'};
	return session;
};

const createMockToolManager = () => ({
	getAvailableToolNames: () => ['read_file'],
	getFilteredTools: () => ({}),
	hasTool: () => true,
	getToolEntry: () => ({approval: false}),
});

/** Every update carrying this tool call id, in emission order. */
const updatesFor = (updates: any[], toolCallId: string) =>
	updates
		.map((u: any) => u.update)
		.filter((u: any) => u.toolCallId === toolCallId);

const respondWith = (toolCalls: ToolCall[]): LLMClient =>
	({
		chat: async () => ({
			choices: [{message: {content: 'Working...', tool_calls: toolCalls}}],
		}),
	}) as unknown as LLMClient;

test.beforeEach(() => {
	setToolRegistryGetter(() => ({}));
	setToolManagerGetter(() => null);
});

// ============================================================================
// A queued call never outlives the turn that announced it
// ============================================================================

test('runAcpConversation - abort marks announced-but-unrun calls failed', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn, 'yolo');

	setToolRegistryGetter(() => ({
		slow_tool: async () => {
			// The user presses Stop while the first tool is still running.
			session.cancel();
			return 'partial output';
		},
		queued_tool: async () => 'should never run',
	}));

	await runAcpConversation({
		session,
		client: respondWith([
			createMockToolCall('slow_tool', {}, 'call-1'),
			createMockToolCall('queued_tool', {}, 'call-2'),
			createMockToolCall('queued_tool', {}, 'call-3'),
		]),
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	// Every announced call must reach a terminal status - a client that does
	// not sweep on turn end (Zed) would otherwise spin on these rows forever.
	for (const id of ['call-2', 'call-3']) {
		const last = updatesFor(updates, id).at(-1);
		t.is(last.status, 'failed', `${id} must not be left pending`);
		t.is(last.rawOutput, 'Cancelled by user');
	}
});

test('runAcpConversation - a cancelled permission sweeps the rest of the batch', async t => {
	const {conn, updates} = createMockConn();
	// The user dismisses the approval prompt for the first tool.
	(conn as any).requestPermission = async () => ({
		outcome: {outcome: 'cancelled'},
	});

	const session = createMockSession(conn, 'normal');
	const executed: string[] = [];
	setToolRegistryGetter(() => ({
		dangerous_tool: async () => {
			executed.push('dangerous_tool');
			return 'ran';
		},
	}));

	const result = await runAcpConversation({
		session,
		client: respondWith([
			createMockToolCall('dangerous_tool', {}, 'call-1'),
			createMockToolCall('dangerous_tool', {}, 'call-2'),
			createMockToolCall('dangerous_tool', {}, 'call-3'),
		]),
		toolManager: {
			...createMockToolManager(),
			getToolEntry: () => ({approval: true}),
		} as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'cancelled');
	t.deepEqual(executed, [], 'nothing runs once the permission is dismissed');

	// This path returns rather than falling through to the aborted check at the
	// top of the loop, so the sweep has to happen here.
	for (const id of ['call-1', 'call-2', 'call-3']) {
		const last = updatesFor(updates, id).at(-1);
		t.is(last.status, 'failed', `${id} must not be left pending`);
		t.is(last.rawOutput, 'Cancelled by user');
	}
});

test('runAcpConversation - a denied permission leaves the queue running', async t => {
	const {conn, updates} = createMockConn();
	// Deny is not cancel: the turn continues with the remaining tools.
	(conn as any).requestPermission = async () => ({
		outcome: {outcome: 'selected', optionId: 'reject'},
	});

	const session = createMockSession(conn, 'normal');
	setToolRegistryGetter(() => ({
		some_tool: async () => 'ran',
	}));

	await runAcpConversation({
		session,
		client: respondWith([
			createMockToolCall('some_tool', {}, 'call-1'),
			createMockToolCall('some_tool', {}, 'call-2'),
		]),
		toolManager: {
			...createMockToolManager(),
			getToolEntry: () => ({approval: true}),
		} as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	for (const id of ['call-1', 'call-2']) {
		const last = updatesFor(updates, id).at(-1);
		t.is(last.status, 'failed');
		t.is(last.rawOutput, 'Denied by user', `${id} was denied, not cancelled`);
	}
});

// ============================================================================
// Announcement shape
// ============================================================================

test('runAcpConversation - an announced call is never sent as tool_call twice', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn, 'yolo');

	setToolRegistryGetter(() => ({
		read_file: async () => 'file contents',
	}));

	await runAcpConversation({
		session,
		client: (() => {
			let calls = 0;
			return {
				chat: async () => {
					calls++;
					if (calls === 1) {
						return {
							choices: [
								{
									message: {
										content: '',
										tool_calls: [
											createMockToolCall('read_file', {path: '/a.txt'}, 'call-1'),
											createMockToolCall('read_file', {path: '/b.txt'}, 'call-2'),
										],
									},
								},
							],
						};
					}
					return {choices: [{message: {content: 'Done'}}]};
				},
			} as unknown as LLMClient;
		})(),
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	// A client that appends on tool_call instead of upserting by id would
	// render the card twice.
	for (const id of ['call-1', 'call-2']) {
		const creates = updatesFor(updates, id).filter(
			(u: any) => u.sessionUpdate === 'tool_call',
		);
		t.is(creates.length, 1, `${id} is created exactly once`);
	}

	// The follow-up still carries the full metadata, just as an update.
	const preRun = updatesFor(updates, 'call-1').filter(
		(u: any) => u.sessionUpdate === 'tool_call_update' && u.status === 'pending',
	);
	t.is(preRun.length, 1);
	t.is(preRun[0].title, 'read_file: /a.txt');
	t.is(preRun[0].kind, 'read');
});

test('runAcpConversation - a single tool call is still announced as tool_call', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn, 'yolo');

	setToolRegistryGetter(() => ({read_file: async () => 'file contents'}));

	await runAcpConversation({
		session,
		client: (() => {
			let calls = 0;
			return {
				chat: async () => {
					calls++;
					if (calls === 1) {
						return {
							choices: [
								{
									message: {
										content: '',
										tool_calls: [
											createMockToolCall('read_file', {path: '/a.txt'}, 'solo'),
										],
									},
								},
							],
						};
					}
					return {choices: [{message: {content: 'Done'}}]};
				},
			} as unknown as LLMClient;
		})(),
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	// No batch to announce, so the card is created by the pre-run emit.
	const creates = updatesFor(updates, 'solo').filter(
		(u: any) => u.sessionUpdate === 'tool_call',
	);
	t.is(creates.length, 1);
	t.is(creates[0].title, 'read_file: /a.txt');
});

test('runAcpConversation - the queued announcement carries no content', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn, 'yolo');

	setToolRegistryGetter(() => ({
		write_file: async () => 'written',
	}));

	await runAcpConversation({
		session,
		client: (() => {
			let calls = 0;
			return {
				chat: async () => {
					calls++;
					if (calls === 1) {
						return {
							choices: [
								{
									message: {
										content: '',
										tool_calls: [
											createMockToolCall(
												'write_file',
												{path: 'a.txt', content: 'hello'},
												'call-1',
											),
											createMockToolCall(
												'write_file',
												{path: 'b.txt', content: 'world'},
												'call-2',
											),
										],
									},
								},
							],
						};
					}
					return {choices: [{message: {content: 'Done'}}]};
				},
			} as unknown as LLMClient;
		})(),
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	// The panel enables "Open Diff" off this field. A diff attached to the
	// announcement would let the user click through to a change the extension
	// host has not registered yet.
	const announcements = updatesFor(updates, 'call-2').filter(
		(u: any) => u.sessionUpdate === 'tool_call',
	);
	t.is(announcements.length, 1);
	t.is(announcements[0].status, 'pending');
	t.is(announcements[0].content, undefined);

	// It is still a usable checklist row.
	t.is(announcements[0].title, 'write_file: b.txt');
	t.is(announcements[0].kind, 'edit');

	// The diff arrives on the pre-run update instead.
	const withDiff = updatesFor(updates, 'call-2').find(
		(u: any) => u.sessionUpdate === 'tool_call_update' && u.content,
	);
	t.truthy(withDiff, 'the diff is emitted before the tool runs');
	t.is(withDiff.content[0].type, 'diff');
});

test('runAcpConversation - cancelled batch tool permission updates ACP cards and balances history without triggering second LLM call', async t => {
	const {conn, updates} = createMockConn();
	(conn as any).requestPermission = async () => ({
		outcome: {outcome: 'cancelled'},
	});

	const session = createMockSession(conn, 'normal');
	const executed: string[] = [];
	setToolRegistryGetter(() => ({
		dangerous_tool: async () => {
			executed.push('dangerous_tool');
			return 'ran';
		},
	}));

	let llmCallCount = 0;
	const result = await runAcpConversation({
		session,
		client: {
			chat: async () => {
				llmCallCount++;
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall('dangerous_tool', {}, 'call-1'),
									createMockToolCall('dangerous_tool', {}, 'call-2'),
									createMockToolCall('dangerous_tool', {}, 'call-3'),
								],
							},
						},
					],
				};
			},
		} as unknown as LLMClient,
		toolManager: {
			...createMockToolManager(),
			getToolEntry: () => ({approval: true}),
		} as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'cancelled');
	t.is(executed.length, 0, 'nothing runs once permission is cancelled');
	t.is(llmCallCount, 1, 'no second LLM call is triggered');

	for (const id of ['call-1', 'call-2', 'call-3']) {
		const last = updatesFor(updates, id).at(-1);
		t.is(last.status, 'failed', `${id} card status must be failed`);
		t.is(last.rawOutput, 'Cancelled by user');
	}

	const results = session.messages.filter((m: any) => m.role === 'tool');
	for (const id of ['call-1', 'call-2', 'call-3']) {
		const matches = results.filter((m: any) => m.tool_call_id === id);
		t.is(matches.length, 1, `exactly one tool result message for ${id}`);
		t.regex(matches[0].content, /cancel/i, `${id} tool result content mentions cancellation`);
	}
});
