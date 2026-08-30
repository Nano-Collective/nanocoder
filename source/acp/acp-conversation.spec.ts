import {randomUUID} from 'node:crypto';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type {AgentSideConnection} from '@agentclientprotocol/sdk';
import {AcpSession} from '@/acp/acp-session';
import {runAcpConversation} from '@/acp/acp-conversation';
import {
	setToolRegistryGetter,
	setToolManagerGetter,
} from '@/message-handler';
import {
	resetSessionContextLimit,
	setSessionContextLimit,
} from '@/models/models-dev-client.js';
import type {LLMClient, Message, ToolCall} from '@/types/core';
import {
	resetAutoCompactSession,
	setAutoCompactStrategy,
	setAutoCompactThreshold,
} from '@/utils/auto-compact.js';

console.log('\nacp-conversation.spec.ts');

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

const createMockConn = (): {
	conn: AgentSideConnection;
	updates: any[];
} => {
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
	opts: {
		sessionId?: string;
		devMode?: any;
		messages?: any[];
		systemMessage?: any;
		aborted?: boolean;
		sessionId?: string;
		cwd?: string;
	} = {},
): AcpSession => {
	const session = new AcpSession({
		// Unique per session so tests never share state, and UUID-shaped so the
		// artifact manager accepts it as a real session id.
		sessionId: opts.sessionId ?? randomUUID(),
		cwd: opts.cwd ?? '/tmp',
		conn,
		initialMode: opts.devMode ?? 'auto-accept',
	});
	session.messages = opts.messages ?? [];
	session.systemMessage = opts.systemMessage ?? {
		role: 'system',
		content: 'You are helpful',
	};
	if (opts.aborted) {
		session.abortController.abort();
	}
	return session;
};

const createMockClient = (
	responses: any[],
): {client: LLMClient; callCount: number} => {
	let callIndex = 0;
	const callCount = {value: 0};
	const client = {
		chat: async () => {
			callCount.value++;
			const response = responses[callIndex++] ?? {
				choices: [
					{
						message: {content: '', tool_calls: []},
					},
				],
			};
			return response;
		},
	} as unknown as LLMClient;
	return {client, callCount: 0};
};

const createMockToolManager = () => ({
	getAvailableToolNames: () => ['read_file'],
	getFilteredTools: () => ({}),
	hasTool: (_name: string) => false,
	getToolEntry: () => ({approval: false}),
	isReadOnly: (name: string) => name !== 'write_file' && name !== 'execute_bash',
});

// ============================================================================
// Reset state
// ============================================================================

test.beforeEach(() => {
	setToolRegistryGetter(() => ({}));
	setToolManagerGetter(() => null);
});

// ============================================================================
// No system message
// ============================================================================

test('runAcpConversation - returns end_turn when no system message', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn, {systemMessage: undefined});
	const {client} = createMockClient([]);

	const result = await runAcpConversation({
		session,
		client: client,
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
});

// ============================================================================
// Cancelled
// ============================================================================

test('runAcpConversation - returns cancelled when abort signal is already set', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn, {aborted: true});
	const {client} = createMockClient([]);

	const result = await runAcpConversation({
		session,
		client: client,
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'cancelled');
});

test('runAcpConversation - treats an aborted model request as cancellation', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn);
	const client = {
		chat: async () => {
			session.cancel();
			throw new Error('Operation was cancelled');
		},
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'cancelled');
});

// ============================================================================
// Empty LLM response
// ============================================================================

test('runAcpConversation - returns end_turn on empty LLM response', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn);
	const {client} = createMockClient([null]);

	const result = await runAcpConversation({
		session,
		client: client,
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
});

test('runAcpConversation - returns end_turn on response with no choices', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn);
	const {client} = createMockClient([{choices: []}]);

	const result = await runAcpConversation({
		session,
		client: client,
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
});

// ============================================================================
// End turn (no tool calls)
// ============================================================================

test('runAcpConversation - returns end_turn when LLM responds with text only', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn);
	const capturedCallbacks: any = {};
	const client = {
		chat: async (
			_msgs: any,
			_tools: any,
			callbacks: any,
		) => {
			Object.assign(capturedCallbacks, callbacks);
			return {
				choices: [{message: {content: 'Hello! I can help you.'}}],
			};
		},
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	// Session messages should contain the assistant response
	t.is(session.messages.length, 1);
	t.is(session.messages[0].role, 'assistant');
	t.is(session.messages[0].content, 'Hello! I can help you.');
});

// ============================================================================
// Streaming callbacks
// ============================================================================

test('runAcpConversation - onToken sends agent_message_chunk updates', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn);
	let capturedCallbacks: any = null;
	const client = {
		chat: async (
			_msgs: any,
			_tools: any,
			callbacks: any,
		) => {
			capturedCallbacks = callbacks;
			return {
				choices: [{message: {content: 'done'}}],
			};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.truthy(capturedCallbacks);
	capturedCallbacks.onToken('Hello ');

	const messageUpdates = updates.filter(
		(u: any) => u.update.sessionUpdate === 'agent_message_chunk',
	);
	t.is(messageUpdates.length, 1);
	t.is(messageUpdates[0].update.content.text, 'Hello ');
});

// Streams the reasoning tokens from inside chat(), the way the real client
// does, so the assertions run against a live turn rather than a closure that
// happens to outlive it.
const createReasoningClient = (tokens: string[]): LLMClient =>
	({
		chat: async (_msgs: any, _tools: any, callbacks: any) => {
			for (const token of tokens) {
				callbacks.onReasoningToken(token);
			}
			return {choices: [{message: {content: 'done'}}]};
		},
	}) as unknown as LLMClient;

const thoughtTexts = (updates: any[]): string[] =>
	updates
		.filter((u: any) => u.update.sessionUpdate === 'agent_thought_chunk')
		.map((u: any) => u.update.content.text);

test('runAcpConversation - onReasoningToken sends agent_thought_chunk updates', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn);

	await runAcpConversation({
		session,
		client: createReasoningClient(['thinking...']),
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.deepEqual(thoughtTexts(updates), ['thinking...']);
});

test('runAcpConversation - skips agent_thought_chunk for leading whitespace-only reasoning', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn);

	await runAcpConversation({
		session,
		client: createReasoningClient([
			'\n\n',
			'Analyzing the request',
			'\n\n',
			'then answering',
		]),
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.deepEqual(thoughtTexts(updates), [
		'Analyzing the request',
		'\n\n',
		'then answering',
	]);
});

test('runAcpConversation - stores exactly the reasoning it streamed', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn);

	await runAcpConversation({
		session,
		client: createReasoningClient(['\n\n', '  Weighing', ' options']),
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	// replaySessionHistory re-sends the stored reasoning verbatim, so it has to
	// be exactly what the live stream showed - no leading whitespace the thought
	// chunks never carried.
	const assistant = session.messages.find((m: any) => m.role === 'assistant');
	t.is(assistant?.reasoning, thoughtTexts(updates).join(''));
	t.is(assistant?.reasoning, 'Weighing options');
});

test('runAcpConversation - stores no reasoning when it was all whitespace', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn);

	await runAcpConversation({
		session,
		client: createReasoningClient(['\n\n', '   ', '\t']),
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.deepEqual(thoughtTexts(updates), []);
	const assistant = session.messages.find((m: any) => m.role === 'assistant');
	t.is(assistant?.reasoning, undefined);
});

test('runAcpConversation - resets streamed reasoning between turns', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn);
	let turn = 0;
	const client = {
		chat: async (_msgs: any, _tools: any, callbacks: any) => {
			turn++;
			callbacks.onReasoningToken(`turn ${turn} thought`);
			if (turn === 1) {
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [createMockToolCall('read_file', {}, 'call-1')],
							},
						},
					],
				};
			}
			return {choices: [{message: {content: 'done'}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	const reasonings = session.messages
		.filter((m: any) => m.role === 'assistant')
		.map((m: any) => m.reasoning);
	t.deepEqual(reasonings, ['turn 1 thought', 'turn 2 thought']);
});

// ============================================================================
// Unknown tool
// ============================================================================

test('runAcpConversation - creates error result for unknown tool and continues loop', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn);
	const toolManager = {
		...createMockToolManager(),
		hasTool: (name: string) => false,
	};

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall('unknown_tool', {}, 'call-1'),
								],
							},
						},
					],
				};
			}

			return {
				choices: [{message: {content: 'Done after error'}}],
			};
		},
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	// Should have made 2 calls: one with the tool call, one after error
	t.is(callCount, 2);
	// Error result should be in messages
	const toolMsg = session.messages.find(
		(m: any) => m.role === 'tool' && m.name === 'unknown_tool',
	);
	t.truthy(toolMsg);
	t.is(toolMsg?.content, 'Unknown tool: unknown_tool');
});

// ============================================================================
// Tool execution
// ============================================================================

test('runAcpConversation - executes tool and emits status updates', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};

	// Set up a mock handler for processToolUse
	setToolRegistryGetter(() => ({
		read_file: async (args: any) => `Content of ${args.path}`,
	}));

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								content: 'Reading file...',
								tool_calls: [
									createMockToolCall('read_file', {path: '/test.txt'}, 'call-1'),
								],
							},
						},
					],
				};
			}

			return {
				choices: [{message: {content: 'Here is the file content'}}],
			};
		},
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	t.is(callCount, 2);

	// Check tool_call updates were emitted
	const toolCallUpdates = updates.filter(
		(u: any) =>
			u.update.sessionUpdate === 'tool_call' ||
			u.update.sessionUpdate === 'tool_call_update',
	);
	t.true(toolCallUpdates.length >= 2);

	// Check the first is the pending notification
	const pendingUpdate = toolCallUpdates.find(
		(u: any) => u.update.status === 'pending',
	);
	t.truthy(pendingUpdate);

	// Check completion notification
	const completedUpdate = toolCallUpdates.find(
		(u: any) => u.update.status === 'completed',
	);
	t.truthy(completedUpdate);
});

test('runAcpConversation - forwards the ACP session id to artifact tools', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn, {
		devMode: 'plan',
		sessionId: '00000000-0000-4000-8000-000000000001',
	});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};

	let receivedSessionId: string | undefined;
	setToolRegistryGetter(() => ({
		write_plan: async (_args: unknown, options) => {
			receivedSessionId = options?.sessionId;
			return 'Plan saved';
		},
	}));

	const {client} = createMockClient([
		{
			choices: [
				{
					message: {
						content: '',
						tool_calls: [
							createMockToolCall(
								'write_plan',
								{content: '# Plan'},
								'call-plan',
							),
						],
					},
				},
			],
		},
		{choices: [{message: {content: 'Plan ready', tool_calls: []}}]},
	]);

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(receivedSessionId, session.sessionId);
});

test('runAcpConversation - completed write_plan exposes its artifact location', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn, {
		devMode: 'plan',
		sessionId: '00000000-0000-4000-8000-000000000002',
	});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};
	setToolRegistryGetter(() => ({
		write_plan: async () => 'Plan saved',
	}));

	const {client} = createMockClient([
		{
			choices: [
				{
					message: {
						content: '',
						tool_calls: [
							createMockToolCall(
								'write_plan',
								{content: '# Plan'},
								'call-plan',
							),
						],
					},
				},
			],
		},
		{choices: [{message: {content: 'Plan ready', tool_calls: []}}]},
	]);

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	const completed = updates.find(
		(u: any) =>
			u.update.sessionUpdate === 'tool_call_update' &&
			u.update.toolCallId === 'call-plan' &&
			u.update.status === 'completed',
	)?.update;
	t.truthy(completed);
	const artifact = completed._meta?.['nanocoder/planArtifact'];
	t.true(artifact.path.endsWith('/implementation_plan.md'));
	t.deepEqual(completed._meta?.['nanocoder/artifact'], {
		kind: 'implementation_plan',
		path: artifact.path,
	});
	t.deepEqual(completed.locations, [{path: artifact.path}]);
	t.is(completed.title, 'Implementation plan ready');
});

test('runAcpConversation - persists a prose plan when write_plan was omitted', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn, {
		devMode: 'plan',
		sessionId: '00000000-0000-4000-8000-000000000003',
	});
	const toolManager = {
		...createMockToolManager(),
		getAvailableToolNames: () => ['read_file', 'write_plan'],
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};

	let persistedContent: unknown;
	let receivedSessionId: string | undefined;
	setToolRegistryGetter(() => ({
		write_plan: async (args: unknown, options) => {
			persistedContent = (args as {content?: unknown}).content;
			receivedSessionId = options?.sessionId;
			return 'Plan saved';
		},
	}));

	const {client} = createMockClient([
		{
			choices: [
				{
					message: {
						content: '# Plan\n\n1. Build it.',
						tool_calls: [],
					},
				},
			],
		},
	]);

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	t.is(persistedContent, '# Plan\n\n1. Build it.');
	t.is(receivedSessionId, session.sessionId);
	const fallbackCall = updates.find(
		(u: any) =>
			u.update.sessionUpdate === 'tool_call' &&
			u.update.title === 'write_plan',
	)?.update;
	t.truthy(fallbackCall);
	const completed = updates.find(
		(u: any) =>
			u.update.sessionUpdate === 'tool_call_update' &&
			u.update.toolCallId === fallbackCall.toolCallId &&
			u.update.status === 'completed',
	)?.update;
	t.true(completed.locations[0].path.endsWith('/implementation_plan.md'));
	t.is(
		completed._meta['nanocoder/artifact'].kind,
		'implementation_plan',
	);
});

// ============================================================================
// write_tasks mirrors to an ACP plan update
// ============================================================================

test('runAcpConversation - write_tasks emits a plan session update', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};

	setToolRegistryGetter(() => ({
		write_tasks: async () => 'Tasks updated',
	}));

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall(
										'write_tasks',
										{
											tasks: [
												{title: 'First task', status: 'completed'},
												{title: 'Second task', status: 'in_progress'},
												{title: 'Third task'},
											],
										},
										'call-1',
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

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');

	const planUpdate = updates.find(
		(u: any) => u.update.sessionUpdate === 'plan',
	) as any;
	t.truthy(planUpdate, 'a plan session update must be emitted');
	t.deepEqual(planUpdate.update.entries, [
		{content: 'First task', priority: 'medium', status: 'completed'},
		{content: 'Second task', priority: 'medium', status: 'in_progress'},
		{content: 'Third task', priority: 'medium', status: 'pending'},
	]);
	const taskArtifact = planUpdate.update._meta?.['nanocoder/artifact'];
	t.is(taskArtifact.kind, 'task');
	t.true(taskArtifact.path.endsWith('/task.md'));
});

test('runAcpConversation - invalid client session IDs omit artifact metadata', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn, {
		devMode: 'yolo',
		sessionId: 'external-session',
	});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};
	setToolRegistryGetter(() => ({write_tasks: async () => 'Tasks updated'}));

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			return callCount === 1
				? {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall(
										'write_tasks',
										{tasks: [{title: 'Safe update'}]},
										'call-invalid-session',
									),
								],
							},
						},
					],
				}
				: {choices: [{message: {content: 'Done'}}]};
		},
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	const planUpdate = updates.find(
		(update: any) => update.update.sessionUpdate === 'plan',
	)?.update;
	t.deepEqual(planUpdate.entries, [
		{content: 'Safe update', priority: 'medium', status: 'pending'},
	]);
	t.is(planUpdate._meta, undefined);
});

test('runAcpConversation - does not nudge task-only work for a walkthrough', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo'});
	const toolManager = {
		...createMockToolManager(),
		getAvailableToolNames: () => ['write_tasks', 'write_walkthrough'],
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};

	setToolRegistryGetter(() => ({
		write_tasks: async () => 'Tasks updated',
		write_walkthrough: async () => 'Walkthrough saved',
	}));

	let callCount = 0;
	let nudge = '';
	const client = {
		chat: async (messages: any[]) => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall('write_tasks', {
										tasks: [{title: 'Implement artifacts'}],
									}),
								],
							},
						},
					],
				};
			}
			if (callCount === 2) {
				return {choices: [{message: {content: 'Implementation complete.'}}]};
			}
			if (callCount === 3) {
				nudge = messages.at(-1)?.content ?? '';
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall('write_walkthrough', {
										summary: 'Implemented artifacts.',
										filesChanged: [],
										tests: [],
										untestedReason: 'Covered by this test.',
										verificationSteps: ['Inspect the artifact.'],
									}),
								],
							},
						},
					],
				};
			}
			return {choices: [{message: {content: 'Walkthrough saved.'}}]};
		},
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	t.is(callCount, 2);
	t.false(nudge.includes('write_walkthrough'));
});

test('runAcpConversation - nudges an approved plan for a walkthrough', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn, {
		devMode: 'yolo',
		messages: [
			{role: 'user', content: '<approved_plan>Implement it.</approved_plan>'},
		],
	});
	const toolManager = {
		...createMockToolManager(),
		getAvailableToolNames: () => ['write_walkthrough'],
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};
	setToolRegistryGetter(() => ({
		write_walkthrough: async () => 'Walkthrough saved',
	}));

	let callCount = 0;
	let nudge = '';
	const client = {
		chat: async (messages: any[]) => {
			callCount++;
			if (callCount === 1) {
				return {choices: [{message: {content: 'Implementation complete.'}}]};
			}
			if (callCount === 2) {
				nudge = messages.at(-1)?.content ?? '';
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall('write_walkthrough', {
										summary: 'Implemented the plan.',
										filesChanged: [],
										tests: [],
										untestedReason: 'Covered by this test.',
										verificationSteps: ['Inspect the artifact.'],
									}),
								],
							},
						},
					],
				};
			}
			return {choices: [{message: {content: 'Walkthrough saved.'}}]};
		},
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	t.is(callCount, 3);
	t.true(nudge.includes('write_walkthrough'));
});

test('runAcpConversation - does not reuse an approved plan from an earlier turn', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn, {
		devMode: 'yolo',
		messages: [
			{role: 'user', content: '<approved_plan>Old work.</approved_plan>'},
			{role: 'assistant', content: 'Old work complete.'},
			{role: 'user', content: 'What did we change?'},
		],
	});
	const toolManager = {
		...createMockToolManager(),
		getAvailableToolNames: () => ['write_walkthrough'],
	};
	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			return {choices: [{message: {content: 'Here is the explanation.'}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(callCount, 1);
});

test('runAcpConversation - announces every queued tool call before running the batch', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};

	const announcedDuringFirstRun: string[] = [];
	setToolRegistryGetter(() => ({
		read_file: async () => {
			if (announcedDuringFirstRun.length === 0) {
				announcedDuringFirstRun.push(
					...updates
						.filter((u: any) => u.update.sessionUpdate === 'tool_call')
						.map((u: any) => u.update.toolCallId),
				);
			}
			return 'file contents';
		},
	}));

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			if (callCount === 1) {
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

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.deepEqual(
		[...new Set(announcedDuringFirstRun)],
		['call-1', 'call-2'],
		'the whole batch must be visible while the first tool is still running',
	);

	const queued = updates.filter(
		(u: any) =>
			u.update.sessionUpdate === 'tool_call' && u.update.status === 'pending',
	);
	t.true(
		queued.every((u: any) => u.update.title),
		'queued announcements carry a title so the checklist is readable',
	);
});

// ============================================================================
// Cancellation mid-turn with queued tools
// ============================================================================

test('runAcpConversation - cancel during a tool skips remaining queued tools and ends the turn', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};

	// The first tool simulates the user pressing Stop while it runs; the
	// second must never execute.
	const executed: string[] = [];
	setToolRegistryGetter(() => ({
		slow_tool: async () => {
			executed.push('slow_tool');
			session.cancel();
			return 'partial output';
		},
		queued_tool: async () => {
			executed.push('queued_tool');
			return 'should never run';
		},
	}));

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			return {
				choices: [
					{
						message: {
							content: 'Working...',
							tool_calls: [
								createMockToolCall('slow_tool', {}, 'call-1'),
								createMockToolCall('queued_tool', {}, 'call-2'),
							],
						},
					},
				],
			};
		},
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'cancelled');
	t.is(callCount, 1, 'no follow-up LLM request after cancel');
	t.deepEqual(executed, ['slow_tool'], 'queued tool must not execute');

	// History stays consistent: both tool calls have matching tool results.
	const toolResults = session.messages.filter((m: any) => m.role === 'tool');
	t.is(toolResults.length, 2);
	const queuedResult = toolResults.find(
		(m: any) => m.tool_call_id === 'call-2',
	) as any;
	t.true(queuedResult.content.includes('cancelled'));
});

// ============================================================================
// Tool execution error
// ============================================================================

test('runAcpConversation - marks tool as failed when result starts with Error', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};

	// Handler that returns an error string
	setToolRegistryGetter(() => ({
		failing_tool: async () => 'Error: something went wrong',
	}));

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall('failing_tool', {}, 'call-1'),
								],
							},
						},
					],
				};
			}

			return {
				choices: [{message: {content: 'I encountered an error'}}],
			};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	const failedUpdate = updates.find(
		(u: any) =>
			u.update.sessionUpdate === 'tool_call_update' &&
			u.update.status === 'failed',
	);
	t.truthy(failedUpdate);
	t.is(failedUpdate?.update.rawOutput, 'Error: something went wrong');
});

// ============================================================================
// Permission denied
// ============================================================================

test('runAcpConversation - denied permission creates denial result and continues', async t => {
	const {conn, updates} = createMockConn();
	// Override permission to deny
	(conn as any).requestPermission = async () => ({
		outcome: {outcome: 'selected', optionId: 'deny'},
	});

	const session = createMockSession(conn, {devMode: 'normal'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: true}),
	};

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall('dangerous_tool', {}, 'call-1'),
								],
							},
						},
					],
				};
			}

			return {
				choices: [{message: {content: 'OK, I will not run that'}}],
			};
		},
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	t.is(callCount, 2);

	// Should have failed status for denied tool
	const failedUpdate = updates.find(
		(u: any) =>
			u.update.sessionUpdate === 'tool_call_update' &&
			u.update.status === 'failed',
	);
	t.truthy(failedUpdate);

	// Denial message should be in messages
	const denialMsg = session.messages.find(
		(m: any) => m.role === 'tool' && m.content === 'Tool call denied by user',
	);
	t.truthy(denialMsg);
});

// ============================================================================
// Permission cancelled
// ============================================================================

test('runAcpConversation - cancelled permission returns cancelled stop reason', async t => {
	const {conn} = createMockConn();
	(conn as any).requestPermission = async () => ({
		outcome: {outcome: 'cancelled'},
	});

	const session = createMockSession(conn, {devMode: 'normal'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: true}),
	};

	const client = {
		chat: async () => ({
			choices: [
				{
					message: {
						content: '',
						tool_calls: [
							createMockToolCall('dangerous_tool', {}, 'call-1'),
							createMockToolCall('queued_tool', {}, 'call-2'),
						],
					},
				},
			],
		}),
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'cancelled');
	const cancelledResults = session.messages.filter(
		(message: any) => message.role === 'tool',
	) as any[];
	t.deepEqual(
		cancelledResults.map(message => message.tool_call_id),
		['call-1', 'call-2'],
		'cancelled permission must balance every queued tool call in history',
	);
	t.true(cancelledResults.every(message => message.content.includes('cancelled')));
});

// ============================================================================
// Yolo mode bypasses approval
// ============================================================================

test('runAcpConversation - yolo mode skips permission request', async t => {
	const {conn} = createMockConn();
	let permissionRequested = false;
	(conn as any).requestPermission = async () => {
		permissionRequested = true;
		return {outcome: {outcome: 'selected', optionId: 'allow'}};
	};

	const session = createMockSession(conn, {devMode: 'yolo'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: true}),
	};

	setToolRegistryGetter(() => ({
		dangerous_tool: async () => 'Result',
	}));

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall('dangerous_tool', {}, 'call-1'),
								],
							},
						},
					],
				};
			}

			return {choices: [{message: {content: 'Done'}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.false(permissionRequested);
});

// ============================================================================
// Non-interactive always-allow
// ============================================================================

test('runAcpConversation - tool in nonInteractiveAlwaysAllow skips approval', async t => {
	const {conn} = createMockConn();
	let permissionRequested = false;
	(conn as any).requestPermission = async () => {
		permissionRequested = true;
		return {outcome: {outcome: 'selected', optionId: 'allow'}};
	};

	const session = createMockSession(conn, {devMode: 'normal'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: true}),
	};

	setToolRegistryGetter(() => ({
		safe_tool: async () => 'Result',
	}));

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [createMockToolCall('safe_tool', {}, 'call-1')],
							},
						},
					],
				};
			}

			return {choices: [{message: {content: 'Done'}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: ['safe_tool'],
	});

	t.false(permissionRequested);
});

// ============================================================================
// XML validation error tool
// ============================================================================

test('runAcpConversation - __xml_validation_error__ tool creates error result', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn);
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => false, // __xml_validation_error__ is not a known tool
	};

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall(
										'__xml_validation_error__',
										{error: 'Bad XML'},
										'call-1',
									),
								],
							},
						},
					],
				};
			}

			return {choices: [{message: {content: 'OK'}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	const errorMsg = session.messages.find(
		(m: any) =>
			m.role === 'tool' && m.name === '__xml_validation_error__',
	);
	t.truthy(errorMsg);
	t.is(errorMsg?.content, 'Unknown tool: __xml_validation_error__');
});

// ============================================================================
// Multi-turn
// ============================================================================

test('runAcpConversation - handles multi-turn conversation with tool calls', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};

	setToolRegistryGetter(() => ({
		read_file: async (args: any) => `Content of ${args.path}`,
	}));

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								content: 'Let me read the file',
								tool_calls: [
									createMockToolCall('read_file', {path: '/a.txt'}, 'call-1'),
								],
							},
						},
					],
				};
			}

			if (callCount === 2) {
				return {
					choices: [
						{
							message: {
								content: 'Now another file',
								tool_calls: [
									createMockToolCall('read_file', {path: '/b.txt'}, 'call-2'),
								],
							},
						},
					],
				};
			}

			return {choices: [{message: {content: 'All done!'}}]};
		},
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	t.is(callCount, 3);

	// Messages should have: assistant, tool, assistant, tool, assistant
	const assistantMsgs = session.messages.filter(
		(m: any) => m.role === 'assistant',
	);
	t.is(assistantMsgs.length, 3);

	const toolMsgs = session.messages.filter((m: any) => m.role === 'tool');
	t.is(toolMsgs.length, 2);
	t.is(toolMsgs[0].content, 'Content of /a.txt');
	t.is(toolMsgs[1].content, 'Content of /b.txt');
});

// ============================================================================
// XML-parsed tool calls (toolsDisabled path)
// ============================================================================

test('runAcpConversation - parses XML tool calls when toolsDisabled', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};

	setToolRegistryGetter(() => ({
		read_file: async (args: any) => `Content of ${args.path}`,
	}));

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			if (callCount === 1) {
				return {
					toolsDisabled: true,
					choices: [
						{
							message: {
								content:
									'I will read the file.\n<function=read_file>\n{"path": "/test.txt"}\n</function>',
							},
						},
					],
				};
			}

			return {choices: [{message: {content: 'Done'}}]};
		},
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	t.is(callCount, 2);

	const toolMsg = session.messages.find(
		(m: any) => m.role === 'tool' && m.name === 'read_file',
	);
	t.truthy(toolMsg);
	t.is(toolMsg?.content, 'Content of /test.txt');
});

// ============================================================================
// Per-turn usage on the PromptResponse
// ============================================================================

test('runAcpConversation - accumulates provider-reported usage across the turn onto the PromptResponse', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};

	setToolRegistryGetter(() => ({
		read_file: async (args: any) => `Content of ${args.path}`,
	}));

	let callCount = 0;
	const client = {
		getCurrentModel: () => 'test-model',
		chat: async () => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								content: 'Reading...',
								tool_calls: [
									createMockToolCall('read_file', {path: '/a.txt'}, 'call-1'),
								],
							},
						},
					],
					usage: {inputTokens: 1000, outputTokens: 50, totalTokens: 1050},
				};
			}
			return {
				choices: [{message: {content: 'Done'}}],
				usage: {inputTokens: 1200, outputTokens: 80, totalTokens: 1280},
			};
		},
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	t.deepEqual(result.usage, {
		inputTokens: 2200,
		outputTokens: 130,
		totalTokens: 2330,
	});
});

test('runAcpConversation - a total-only provider still reports usage on the PromptResponse', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn);
	const client = {
		getCurrentModel: () => 'test-model',
		chat: async () => ({
			choices: [{message: {content: 'Hello'}}],
			usage: {totalTokens: 1500},
		}),
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	// Wire format zero-fills unreported fields (the ACP Usage type requires
	// them), but the total carries the real figure. Internally the sparse
	// {totalTokens} shape is what prices the turn — zero-filled input/output
	// would take the wrong buildResponseUsage branch and cost out at $0
	// (covered by the lump-sum test in response-usage.spec.ts).
	t.deepEqual(result.usage, {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 1500,
	});
});

test('runAcpConversation - an input-only provider does not fabricate output tokens', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn);
	const client = {
		getCurrentModel: () => 'test-model',
		chat: async () => ({
			choices: [{message: {content: 'Hello'}}],
			usage: {inputTokens: 800},
		}),
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	t.deepEqual(result.usage, {
		inputTokens: 800,
		outputTokens: 0,
		totalTokens: 800,
	});
});

test('runAcpConversation - omits usage from the PromptResponse when the provider reports none', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn);
	const client = {
		getCurrentModel: () => 'test-model',
		chat: async () => ({
			choices: [{message: {content: 'Hello'}}],
		}),
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	t.is(result.usage, undefined);
	t.is(result._meta, undefined);
});

// ============================================================================
// ask_user (interactive)
// ============================================================================

test('runAcpConversation - ask_user coerces object options and returns the choice', async t => {
	const updates: any[] = [];
	const conn = {
		sessionUpdate: async (u: any) => {
			updates.push(u);
		},
		// Select whichever option is at index 1.
		requestPermission: async (p: any) => ({
			outcome: {outcome: 'selected', optionId: p.options[1].optionId},
		}),
	} as unknown as AgentSideConnection;

	const session = createMockSession(conn);
	const askCall = createMockToolCall(
		'ask_user',
		{
			question: 'Pick one',
			// Model sends objects rather than plain strings.
			options: [{description: 'First'}, {description: 'Second'}],
		},
		'call-ask',
	);
	const {client} = createMockClient([
		{
			choices: [{message: {content: '', tool_calls: [askCall]}}],
			toolsDisabled: false,
		},
	]);
	const toolManager = {
		getAvailableToolNames: () => ['ask_user'],
		getFilteredTools: () => ({}),
		hasTool: (n: string) => n === 'ask_user',
		getToolEntry: () => ({approval: false}),
		isReadOnly: () => true,
	};

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(result.stopReason, 'end_turn');
	const toolMsg = session.messages.find(
		(m: any) => m.role === 'tool' && m.name === 'ask_user',
	);
	t.is(toolMsg?.content, 'Second');
});

test('runAcpConversation - ask_user fails cleanly when no usable options', async t => {
	const conn = {
		sessionUpdate: async () => {},
		requestPermission: async () => ({outcome: {outcome: 'cancelled'}}),
	} as unknown as AgentSideConnection;

	const session = createMockSession(conn);
	const askCall = createMockToolCall(
		'ask_user',
		{question: 'Pick one', options: []},
		'call-ask',
	);
	const {client} = createMockClient([
		{
			choices: [{message: {content: '', tool_calls: [askCall]}}],
			toolsDisabled: false,
		},
	]);
	const toolManager = {
		getAvailableToolNames: () => ['ask_user'],
		getFilteredTools: () => ({}),
		hasTool: (n: string) => n === 'ask_user',
		getToolEntry: () => ({approval: false}),
		isReadOnly: () => true,
	};

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	const toolMsg = session.messages.find(
		(m: any) => m.role === 'tool' && m.name === 'ask_user',
	);
	t.true(toolMsg?.content.startsWith('Error:'));
});

// The ACP option bound has to match the `ask_user` tool schema (2-6), otherwise
// identical prompts succeed in the CLI and fail in the VS Code extension.
test('runAcpConversation - ask_user accepts six options', async t => {
	const conn = {
		sessionUpdate: async () => {},
		requestPermission: async (p: any) => ({
			outcome: {outcome: 'selected', optionId: p.options[5].optionId},
		}),
	} as unknown as AgentSideConnection;

	const session = createMockSession(conn);
	const askCall = createMockToolCall(
		'ask_user',
		{question: 'Pick one', options: ['A', 'B', 'C', 'D', 'E', 'F']},
		'call-ask',
	);
	const {client} = createMockClient([
		{
			choices: [{message: {content: '', tool_calls: [askCall]}}],
			toolsDisabled: false,
		},
	]);
	const toolManager = {
		getAvailableToolNames: () => ['ask_user'],
		getFilteredTools: () => ({}),
		hasTool: (n: string) => n === 'ask_user',
		getToolEntry: () => ({approval: false}),
		isReadOnly: () => true,
	};

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	const toolMsg = session.messages.find(
		(m: any) => m.role === 'tool' && m.name === 'ask_user',
	);
	t.is(toolMsg?.content, 'F');
});

test('runAcpConversation - ask_user rejects more than six options', async t => {
	const conn = {
		sessionUpdate: async () => {},
		requestPermission: async () => {
			t.fail('should not prompt the client for an out-of-range option list');
			return {outcome: {outcome: 'cancelled'}};
		},
	} as unknown as AgentSideConnection;

	const session = createMockSession(conn);
	const askCall = createMockToolCall(
		'ask_user',
		{question: 'Pick one', options: ['A', 'B', 'C', 'D', 'E', 'F', 'G']},
		'call-ask',
	);
	const {client} = createMockClient([
		{
			choices: [{message: {content: '', tool_calls: [askCall]}}],
			toolsDisabled: false,
		},
	]);
	const toolManager = {
		getAvailableToolNames: () => ['ask_user'],
		getFilteredTools: () => ({}),
		hasTool: (n: string) => n === 'ask_user',
		getToolEntry: () => ({approval: false}),
		isReadOnly: () => true,
	};

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	const toolMsg = session.messages.find(
		(m: any) => m.role === 'tool' && m.name === 'ask_user',
	);
	t.true(toolMsg?.content.startsWith('Error:'));
	t.true(toolMsg?.content.includes('2-6'));
});

// ============================================================================
// Action timeline capture
// ============================================================================

test('runAcpConversation - captures a timeline checkpoint for write_file', async t => {
	const {conn} = createMockConn();
	const cwd = join(
		tmpdir(),
		`nanocoder-timeline-conv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(cwd, {recursive: true});
	t.teardown(() => rmSync(cwd, {recursive: true, force: true}));
	writeFileSync(join(cwd, 'a.ts'), 'before');

	const session = createMockSession(conn, {devMode: 'yolo', cwd});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		isReadOnly: (name: string) => name !== 'write_file',
	};

	setToolRegistryGetter(() => ({
		write_file: async () => 'Wrote a.ts',
	}));

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall(
										'write_file',
										{path: 'a.ts', content: 'after'},
										'call-write',
									),
								],
							},
						},
					],
				};
			}
			return {choices: [{message: {content: 'done'}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	const entries = await session.timeline.list();
	t.is(entries.length, 1);
	t.is(entries[0].toolName, 'write_file');
	t.is(entries[0].toolCallId, 'call-write');
	t.is(entries[0].truncateToMessageIndex, 0);
});

test('runAcpConversation - does not capture a timeline checkpoint for read_file', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		isReadOnly: () => true,
	};

	setToolRegistryGetter(() => ({
		read_file: async () => 'content',
	}));

	let callCount = 0;
	const client = {
		chat: async () => {
			callCount++;
			if (callCount === 1) {
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall('read_file', {path: 'a.ts'}, 'call-read'),
								],
							},
						},
					],
				};
			}
			return {choices: [{message: {content: 'done'}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.deepEqual(await session.timeline.list(), []);
});

test.serial(
	'runAcpConversation - compacts history before the next model turn when over the token threshold',
	async t => {
		resetAutoCompactSession();
		resetSessionContextLimit();
		setSessionContextLimit(100);
		setAutoCompactStrategy('mechanical');
		setAutoCompactThreshold(50);

		const filler = 'old context sentence. '.repeat(60);
		const {conn} = createMockConn();
		const session = createMockSession(conn, {
			devMode: 'yolo',
			messages: [
				{role: 'user', content: filler},
				{role: 'assistant', content: 'ack'},
				{role: 'user', content: 'call the tool'},
			],
		});
		const toolManager = {
			...createMockToolManager(),
			hasTool: () => true,
			getToolEntry: () => ({approval: false}),
		};
		setToolRegistryGetter(() => ({
			read_file: async () => 'ok',
		}));

		const payloads: Message[][] = [];
		let callCount = 0;
		const client = {
			getCurrentModel: () => 'gpt-4',
			getProviderConfig: () => ({name: 'openai'}),
			chat: async (messages: Message[]) => {
				payloads.push(messages);
				callCount++;
				if (callCount === 1) {
					return {
						choices: [
							{
								message: {
									content: '',
									tool_calls: [
										createMockToolCall('read_file', {path: 'a.ts'}, 'call-1'),
									],
								},
							},
						],
					};
				}
				return {choices: [{message: {content: 'done'}}]};
			},
		} as unknown as LLMClient;

		try {
			const result = await runAcpConversation({
				session,
				client,
				toolManager: toolManager as any,
				conn,
				nonInteractiveAlwaysAllow: [],
			});

			t.is(result.stopReason, 'end_turn');
			t.is(payloads.length, 2);
			const secondHistory = payloads[1]
				.slice(1)
				.map(m => (typeof m.content === 'string' ? m.content : ''))
				.join('');
			t.true(secondHistory.length < filler.length);
		} finally {
			resetAutoCompactSession();
			resetSessionContextLimit();
		}
	},
);

