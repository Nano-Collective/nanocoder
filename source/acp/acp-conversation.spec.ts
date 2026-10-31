import {randomUUID} from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type {AgentSideConnection} from '@agentclientprotocol/sdk';
import {AcpSession} from '@/acp/acp-session';
import {runAcpConversation} from '@/acp/acp-conversation';
import {
	getSessionCwd,
	resetSessionCwd,
	setProjectRoot,
	setSessionCwd,
} from '@/services/session-cwd';
import {executeBashTool} from '@/tools/execute-bash';
import {fileOpTool} from '@/tools/file-ops/file-op';
import {writeFileTool} from '@/tools/file-ops/write-file';
import {readFileTool} from '@/tools/read-file';
import {ToolRegistry} from '@/tools/tool-registry';
import {clearReadTracker} from '@/utils/read-tracker';
import {
	cancelSubagentRun,
	emitSubagentRunEvent,
} from '@/services/subagent-events';
import {SubagentExecutor} from '@/subagents/subagent-executor';
import {getSubagentLoader} from '@/subagents/subagent-loader';
import {agentTool, setAgentToolExecutor} from '@/tools/agent-tool';
import type {ToolManager} from '@/tools/tool-manager';
import {getSubagentToolBridge} from '@/utils/tool-approval-queue';
import {
	setToolRegistryGetter,
	setToolManagerGetter,
} from '@/message-handler';
import {
	resetSessionContextLimit,
	setSessionContextLimit,
} from '@/models/models-dev-client.js';
import type {
	DevelopmentMode,
	LLMClient,
	Message,
	ToolCall,
} from '@/types/core';
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
	// What the session offers the model. A call to a registered tool outside
	// this list is refused, so it must name every tool the tests below run.
	getAvailableToolNames: () => [
		'read_file',
		'write_file',
		'execute_bash',
		'file_op',
		'agent',
		'browser',
		'write_tasks',
		'lookup',
		'safe_tool',
		'dangerous_tool',
		'failing_tool',
		'slow_tool',
		'queued_tool',
	],
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
		getAvailableToolNames: () => ['write_plan'],
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

test('runAcpConversation - marks tool as failed when it reports isError without an Error prefix', async t => {
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo'});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};

	// A command that ran and exited non-zero: the text is a plain exit report
	setToolRegistryGetter(() => ({
		failing_tool: async () => ({llmContent: 'EXIT_CODE: 3\n', isError: true}),
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
				choices: [{message: {content: 'The command failed'}}],
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

	const finalUpdates = updates.filter(
		(u: any) =>
			u.update.sessionUpdate === 'tool_call_update' &&
			(u.update.status === 'failed' || u.update.status === 'completed'),
	);
	t.is(finalUpdates.length, 1);
	t.is(finalUpdates[0].update.status, 'failed');
	t.is(finalUpdates[0].update.rawOutput, 'EXIT_CODE: 3\n');
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

test('runAcpConversation - checkpoints of one prompt share a turn id across model round-trips', async t => {
	const {conn} = createMockConn();
	const cwd = join(
		tmpdir(),
		`nanocoder-timeline-turn-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(cwd, {recursive: true});
	t.teardown(() => rmSync(cwd, {recursive: true, force: true}));
	writeFileSync(join(cwd, 'a.ts'), 'v0');

	const session = createMockSession(conn, {devMode: 'yolo', cwd});
	const toolManager = {
		...createMockToolManager(),
		hasTool: () => true,
		isReadOnly: (name: string) => name !== 'write_file',
	};

	// Applies the edit, so each checkpoint's before-image is the previous write.
	setToolRegistryGetter(() => ({
		write_file: async (args: {path: string; content: string}) => {
			writeFileSync(join(cwd, args.path), args.content);
			return `Wrote ${args.path}`;
		},
	}));

	// Each model round-trip edits a.ts once, then the prompt ends.
	const scriptedClient = (contents: string[]) => {
		let callCount = 0;
		return {
			chat: async () => {
				const content = contents[callCount];
				callCount++;
				if (content === undefined) {
					return {choices: [{message: {content: 'done'}}]};
				}
				return {
					choices: [
						{
							message: {
								content: '',
								tool_calls: [
									createMockToolCall(
										'write_file',
										{path: 'a.ts', content},
										`call-${content}`,
									),
								],
							},
						},
					],
				};
			},
		} as unknown as LLMClient;
	};
	const runPrompt = (contents: string[]) =>
		runAcpConversation({
			session,
			client: scriptedClient(contents),
			toolManager: toolManager as any,
			conn,
			nonInteractiveAlwaysAllow: [],
		});

	await runPrompt(['v1', 'v2']);
	await runPrompt(['v3']);

	const [first, second, nextPrompt] = await session.timeline.list();

	// Two round-trips of one prompt: `truncateToMessageIndex` moved on, so it
	// cannot group them, but the turn id does.
	t.not(first.truncateToMessageIndex, second.truncateToMessageIndex);
	t.truthy(first.turnId);
	t.is(first.turnId, second.turnId);
	// The next prompt is a new turn.
	t.truthy(nextPrompt.turnId);
	t.not(nextPrompt.turnId, first.turnId);

	// The documented baseline: the earliest checkpoint of the turn holds the
	// file as it was before the agent touched it, not after its first edit.
	t.deepEqual(await session.timeline.readBefore(first.id, 'a.ts'), {
		kind: 'text',
		content: 'v0',
	});
	t.deepEqual(await session.timeline.readBefore(second.id, 'a.ts'), {
		kind: 'text',
		content: 'v1',
	});
	t.deepEqual(await session.timeline.readBefore(nextPrompt.id, 'a.ts'), {
		kind: 'text',
		content: 'v2',
	});
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
			t.false(
				payloads[1].some(
					m => typeof m.content === 'string' && m.content.includes(filler),
				),
				'the verbose turn must be compressed out of the next model turn',
			);
			t.true(
				secondHistory.includes('call the tool'),
				'compaction must keep the recent turn, not empty the history',
			);
		} finally {
			resetAutoCompactSession();
			resetSessionContextLimit();
		}
	},
);


// ============================================================================
// Sub-agent tool calls (#1019, #1105)
// ============================================================================

/**
 * Drives the session's sub-agent bridge from inside the turn, which is the only
 * way the sub-agent executor ever reaches it. Firing it after runAcpConversation
 * returned would only pass while the bridge leaked past the turn.
 */
const callThroughBridge = async (
	requestPermission: (p: any) => Promise<any>,
	{
		ask = true,
		outcome = {content: 'wrote it', failed: false},
		subagentRunId,
	}: {
		ask?: boolean;
		outcome?: {content: string; failed: boolean};
		subagentRunId?: string;
	} = {},
) => {
	const updates: any[] = [];
	const permissionRequests: any[] = [];
	let decision: string | undefined;
	let called = false;

	const conn = {
		sessionUpdate: async (u: any) => {
			updates.push(u.update);
		},
		requestPermission: async (p: any) => {
			permissionRequests.push(p);
			return requestPermission(p);
		},
	} as unknown as AgentSideConnection;

	const session = createMockSession(conn);
	// chat() is awaited by the turn, so this is a point where the bridge is
	// registered and the turn has not returned - the state the sub-agent
	// executor calls it from.
	const client = {
		chat: async () => {
			if (!called) {
				called = true;
				const bridge = getSubagentToolBridge(session.sessionId)!;
				const toolCall = createMockToolCall('write_file', {path: 'a.txt'}, 'call-1');
				await bridge.begin(toolCall, 'docs');
				if (ask) {
					decision = await bridge.approve(toolCall, undefined, subagentRunId);
				}
				await bridge.end(toolCall, outcome);
			}
			return {
				choices: [{message: {content: 'done', tool_calls: []}}],
				toolsDisabled: false,
			};
		},
	} as unknown as LLMClient;
	const toolManager = {
		getAvailableToolNames: () => [],
		getFilteredTools: () => ({}),
		hasTool: () => false,
		getToolEntry: () => undefined,
		isReadOnly: () => true,
	};

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	return {decision, updates, permissionRequests, session};
};

const allowOnce = async () => ({outcome: {outcome: 'selected', optionId: 'allow'}});

test('runAcpConversation - a sub-agent tool call is announced, approved and settled with its real outcome', async t => {
	const {decision, updates, permissionRequests} =
		await callThroughBridge(allowOnce);

	t.is(decision, 'approved');
	t.is(permissionRequests.length, 1);

	// Prefixed: sub-agent ids come from the sub-agent's own model and share an
	// id space with top-level calls, so an unprefixed id could merge two cards.
	const announcedId = permissionRequests[0].toolCall.toolCallId;
	t.is(announcedId, 'subagent:call-1');
	t.true(String(permissionRequests[0].toolCall.title).includes('docs'));

	// Announced before the request, or the client rejects the id.
	const announced = updates.filter(
		(u: any) => u.sessionUpdate === 'tool_call' && u.toolCallId === announcedId,
	);
	t.is(announced.length, 1);
	t.is(announced[0].status, 'pending');

	// Settled by the tool's own result, not by the approval.
	const terminal = updates.filter(
		(u: any) => u.toolCallId === announcedId && u.status === 'completed',
	);
	t.is(terminal.length, 1);
	t.is(terminal[0].rawOutput, 'wrote it');
});

test('runAcpConversation - a sub-agent call that fails after approval is reported failed', async t => {
	const {updates} = await callThroughBridge(allowOnce, {
		outcome: {content: 'Error: disk full', failed: true},
	});

	// Approval no longer claims success: only the tool's result settles the card.
	const forCall = updates.filter((u: any) => u.toolCallId === 'subagent:call-1');
	t.false(forCall.some((u: any) => u.status === 'completed'));
	const failed = forCall.filter((u: any) => u.status === 'failed');
	t.is(failed.length, 1);
	t.is(failed[0].rawOutput, 'Error: disk full');
});

test('runAcpConversation - a sub-agent call needing no approval is still announced and settled', async t => {
	const {updates, permissionRequests} = await callThroughBridge(allowOnce, {
		ask: false,
	});

	t.is(permissionRequests.length, 0);
	const forCall = updates.filter((u: any) => u.toolCallId === 'subagent:call-1');
	t.is(forCall[0].sessionUpdate, 'tool_call');
	t.is(forCall[forCall.length - 1].status, 'completed');
});

test('runAcpConversation - a denied sub-agent permission is reported as denied', async t => {
	const {decision, permissionRequests} = await callThroughBridge(async () => ({
		outcome: {outcome: 'selected', optionId: 'deny'},
	}));

	t.is(decision, 'denied');
	t.is(permissionRequests.length, 1);
});

test('runAcpConversation - a cancelled sub-agent permission is reported as cancelled', async t => {
	const {decision, permissionRequests} = await callThroughBridge(async () => ({
		outcome: {outcome: 'cancelled'},
	}));

	// Distinct from the deny path, so a client can tell a user's refusal from
	// a turn that was torn down under it.
	t.is(decision, 'cancelled');
	t.is(permissionRequests.length, 1);
});

test('runAcpConversation - a transport failure denies the tool rather than aborting the sub-agent', async t => {
	const {decision, permissionRequests} = await callThroughBridge(async () => {
		throw new Error('connection closed');
	});

	// The bridge is awaited outside the sub-agent executor's own try, so a
	// throw here would abort the whole run instead of denying one tool.
	t.is(decision, 'denied');
	t.is(permissionRequests.length, 1);
});

test('runAcpConversation - the sub-agent bridge does not outlive the turn', async t => {
	const {session} = await callThroughBridge(allowOnce);

	// A bridge left registered would keep a finished turn's session and
	// connection reachable.
	t.is(getSubagentToolBridge(session.sessionId), undefined);
});

test('runAcpConversation - the sub-agent bridge reports the session mode as it is now', async t => {
	const seen: string[] = [];
	const {conn} = createMockConn();
	const session = createMockSession(conn, {devMode: 'normal'});
	const client = {
		chat: async () => {
			const bridge = getSubagentToolBridge(session.sessionId)!;
			seen.push(bridge.getMode());
			// A switch made while the sub-agent is running.
			session.developmentMode = 'yolo';
			seen.push(bridge.getMode());
			return {
				choices: [{message: {content: 'done', tool_calls: []}}],
				toolsDisabled: false,
			};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: {
			getAvailableToolNames: () => [],
			getFilteredTools: () => ({}),
			hasTool: () => false,
			getToolEntry: () => undefined,
			isReadOnly: () => true,
		} as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.deepEqual(seen, ['normal', 'yolo']);
});

test('runAcpConversation - overlapping sessions each answer their own sub-agent prompts', async t => {
	const makeSession = () => {
		const permissionRequests: any[] = [];
		const conn = {
			sessionUpdate: async () => {},
			requestPermission: async (p: any) => {
				permissionRequests.push(p);
				return {outcome: {outcome: 'selected', optionId: 'allow'}};
			},
		} as unknown as AgentSideConnection;
		return {conn, permissionRequests, session: createMockSession(conn)};
	};
	const a = makeSession();
	const b = makeSession();

	// Both turns wait inside chat() until both are running: the overlap the
	// single process-wide slot answered with the later session's connection.
	let started = 0;
	let release!: () => void;
	const bothRunning = new Promise<void>(resolve => {
		release = resolve;
	});
	const run = (s: ReturnType<typeof makeSession>) =>
		runAcpConversation({
			session: s.session,
			client: {
				chat: async () => {
					if (++started === 2) release();
					await bothRunning;
					await getSubagentToolBridge(s.session.sessionId)!.approve(
						createMockToolCall('write_file', {path: 'a.txt'}, 'call-1'),
					);
					return {
						choices: [{message: {content: 'done', tool_calls: []}}],
						toolsDisabled: false,
					};
				},
			} as unknown as LLMClient,
			toolManager: {
				getAvailableToolNames: () => [],
				getFilteredTools: () => ({}),
				hasTool: () => false,
				getToolEntry: () => undefined,
				isReadOnly: () => true,
			} as any,
			conn: s.conn,
			nonInteractiveAlwaysAllow: [],
		});

	await Promise.all([run(a), run(b)]);

	t.is(a.permissionRequests.length, 1);
	t.is(a.permissionRequests[0].sessionId, a.session.sessionId);
	t.is(b.permissionRequests.length, 1);
	t.is(b.permissionRequests[0].sessionId, b.session.sessionId);
});

async function readThroughAcp(
	session: AcpSession,
	conn: AgentSideConnection,
	path: string,
): Promise<string> {
	setToolRegistryGetter(() => ({
		read_file: (args: any) =>
			readFileTool.tool.execute!(args, {toolCallId: 'read', messages: []}),
	}));
	let calls = 0;
	const client = {
		chat: async () => {
			calls++;
			return calls === 1
				? {
						choices: [
							{
								message: {
									content: '',
									tool_calls: [createMockToolCall('read_file', {path})],
								},
							},
						],
					}
				: {choices: [{message: {content: 'done'}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: {...createMockToolManager(), hasTool: () => true} as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});
	const result = session.messages.findLast(
		(m: Message) => m.role === 'tool' && m.name === 'read_file',
	);
	return String(result?.content ?? '');
}

test.serial(
	'runAcpConversation - one ACP chat does not get read stubs from another',
	async t => {
		clearReadTracker();
		const dir = join(process.cwd(), `test-acp-read-scope-${randomUUID()}`);
		mkdirSync(dir, {recursive: true});
		const file = join(dir, 'shared.ts');
		writeFileSync(file, 'export const shared = 1;\n');
		try {
			const {conn} = createMockConn();
			const first = createMockSession(conn, {devMode: 'yolo'});
			const second = createMockSession(conn, {devMode: 'yolo'});

			t.true(
				(await readThroughAcp(first, conn, file)).includes('shared = 1'),
			);
			const other = await readThroughAcp(second, conn, file);
			t.true(other.includes('shared = 1'));
			t.false(other.includes('already in context'));
		} finally {
			clearReadTracker();
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'runAcpConversation - a repeat read in the same ACP chat still stubs',
	async t => {
		clearReadTracker();
		const dir = join(process.cwd(), `test-acp-read-scope-${randomUUID()}`);
		mkdirSync(dir, {recursive: true});
		const file = join(dir, 'same.ts');
		writeFileSync(file, 'export const same = 1;\n');
		try {
			const {conn} = createMockConn();
			const session = createMockSession(conn, {devMode: 'yolo'});

			t.true(
				(await readThroughAcp(session, conn, file)).includes('same = 1'),
			);
			t.true(
				(await readThroughAcp(session, conn, file)).includes(
					'already in context',
				),
			);
		} finally {
			clearReadTracker();
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

// ============================================================================
// file_op approval in auto-accept (#1683)
// ============================================================================

// ACP sessions start in auto-accept. A file_op delete, or a move/copy onto an
// existing file, must still reach the client for permission there, the same
// as `rm` through execute_bash. These drive the real file_op tool so the file
// on disk is the evidence.

const createFileOpWorkspace = (t: any): string => {
	const cwd = join(
		tmpdir(),
		`nanocoder-file-op-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(cwd, {recursive: true});
	writeFileSync(join(cwd, 'greet.py'), "print('Hello, Agent!')\n");
	writeFileSync(join(cwd, 'other.py'), "print('other')\n");
	setProjectRoot(cwd);
	setSessionCwd(cwd);
	t.teardown(() => {
		resetSessionCwd();
		rmSync(cwd, {recursive: true, force: true});
	});
	return cwd;
};

const runFileOpTurn = async (
	cwd: string,
	args: Record<string, unknown>,
	outcome: {outcome: 'selected'; optionId: string} | {outcome: 'cancelled'},
) => {
	const permissionRequests: any[] = [];
	const {conn, updates} = createMockConn();
	(conn as any).requestPermission = async (request: any) => {
		permissionRequests.push(request);
		return {outcome};
	};

	// Left at the ACP default mode, as an editor client that never changes it.
	const session = createMockSession(conn, {cwd});
	const registry = ToolRegistry.fromToolExports([fileOpTool]);
	setToolRegistryGetter(() => registry.getHandlers());
	const toolManager = {
		...createMockToolManager(),
		hasTool: (name: string) => registry.hasTool(name),
		getToolEntry: (name: string) => registry.getEntry(name),
		isReadOnly: () => false,
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
								tool_calls: [createMockToolCall('file_op', args, 'call-op')],
							},
						},
					],
				};
			}
			return {choices: [{message: {content: 'done'}}]};
		},
	} as unknown as LLMClient;

	const result = await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	const statuses = updates
		.filter((u: any) => u.update.toolCallId === 'call-op')
		.map((u: any) => u.update.status);

	return {result, session, permissionRequests, statuses};
};

const allow = {outcome: 'selected', optionId: 'allow'} as const;
const deny = {outcome: 'selected', optionId: 'deny'} as const;
const cancel = {outcome: 'cancelled'} as const;

test('runAcpConversation - an auto-accept session asks before file_op deletes, and approval runs it', async t => {
	const cwd = createFileOpWorkspace(t);

	const {result, permissionRequests, statuses} = await runFileOpTurn(
		cwd,
		{operation: 'delete', path: 'greet.py'},
		allow,
	);

	t.is(result.stopReason, 'end_turn');
	t.is(permissionRequests.length, 1);
	t.is(permissionRequests[0].toolCall.toolCallId, 'call-op');
	t.is(permissionRequests[0].toolCall.kind, 'delete');
	t.true(statuses.includes('completed'));
	t.false(existsSync(join(cwd, 'greet.py')));
});

test('runAcpConversation - a denied file_op delete leaves the file intact', async t => {
	const cwd = createFileOpWorkspace(t);

	const {result, session, permissionRequests, statuses} = await runFileOpTurn(
		cwd,
		{operation: 'delete', path: 'greet.py'},
		deny,
	);

	t.is(result.stopReason, 'end_turn');
	t.is(permissionRequests.length, 1);
	t.true(statuses.includes('failed'));
	t.true(
		session.messages.some(
			(m: any) => m.role === 'tool' && m.content === 'Tool call denied by user',
		),
	);
	t.is(readFileSync(join(cwd, 'greet.py'), 'utf8'), "print('Hello, Agent!')\n");
});

test('runAcpConversation - a cancelled file_op delete leaves the file intact', async t => {
	const cwd = createFileOpWorkspace(t);

	const {result, permissionRequests} = await runFileOpTurn(
		cwd,
		{operation: 'delete', path: 'greet.py'},
		cancel,
	);

	t.is(result.stopReason, 'cancelled');
	t.is(permissionRequests.length, 1);
	t.is(readFileSync(join(cwd, 'greet.py'), 'utf8'), "print('Hello, Agent!')\n");
});

for (const operation of ['move', 'copy']) {
	test(`runAcpConversation - an auto-accept session asks before a file_op ${operation} overwrites, and approval runs it`, async t => {
		const cwd = createFileOpWorkspace(t);

		const {permissionRequests, statuses} = await runFileOpTurn(
			cwd,
			{operation, path: 'greet.py', destination: 'other.py'},
			allow,
		);

		t.is(permissionRequests.length, 1);
		t.true(statuses.includes('completed'));
		t.is(readFileSync(join(cwd, 'other.py'), 'utf8'), "print('Hello, Agent!')\n");
	});

	test(`runAcpConversation - a denied file_op ${operation} onto an existing file leaves both files intact`, async t => {
		const cwd = createFileOpWorkspace(t);

		const {permissionRequests} = await runFileOpTurn(
			cwd,
			{operation, path: 'greet.py', destination: 'other.py'},
			deny,
		);

		t.is(permissionRequests.length, 1);
		t.is(readFileSync(join(cwd, 'greet.py'), 'utf8'), "print('Hello, Agent!')\n");
		t.is(readFileSync(join(cwd, 'other.py'), 'utf8'), "print('other')\n");
	});

	test(`runAcpConversation - a cancelled file_op ${operation} onto an existing file leaves both files intact`, async t => {
		const cwd = createFileOpWorkspace(t);

		const {result, permissionRequests} = await runFileOpTurn(
			cwd,
			{operation, path: 'greet.py', destination: 'other.py'},
			cancel,
		);

		t.is(result.stopReason, 'cancelled');
		t.is(permissionRequests.length, 1);
		t.is(readFileSync(join(cwd, 'greet.py'), 'utf8'), "print('Hello, Agent!')\n");
		t.is(readFileSync(join(cwd, 'other.py'), 'utf8'), "print('other')\n");
	});
}

test('runAcpConversation - a file_op move to a new path still runs unprompted in auto-accept', async t => {
	const cwd = createFileOpWorkspace(t);

	const {permissionRequests, statuses} = await runFileOpTurn(
		cwd,
		{operation: 'move', path: 'greet.py', destination: 'hello.py'},
		deny,
	);

	t.is(permissionRequests.length, 0);
	t.true(statuses.includes('completed'));
	t.false(existsSync(join(cwd, 'greet.py')));
	t.true(existsSync(join(cwd, 'hello.py')));
});

// ============================================================================
// Session working directory (#1707)
// ============================================================================

// The ACP spec makes the `cwd` from session/new the base for relative paths and
// the boundary for tool operations, wherever the agent was spawned. These tests
// run the agent from the repository checkout and point the session at a temp
// project, so every assertion separates the session cwd from process.cwd().

const createCwdProject = (t: any, name: string): string => {
	const dir = realpathSync(
		mkdtempSync(join(tmpdir(), `nanocoder-acp-cwd-${name}-`)),
	);
	writeFileSync(join(dir, 'marker.txt'), `${name} marker\n`);
	t.teardown(() => rmSync(dir, {recursive: true, force: true}));
	return dir;
};

const runScriptedToolTurns = async (
	session: AcpSession,
	toolCallTurns: ToolCall[][],
	holdFinalAnswer?: Promise<unknown>,
) => {
	const registry = ToolRegistry.fromToolExports([
		readFileTool,
		writeFileTool,
		executeBashTool,
	]);
	setToolRegistryGetter(() => registry.getHandlers());
	const toolManager = {
		...createMockToolManager(),
		hasTool: (name: string) => registry.hasTool(name),
		getToolEntry: (name: string) => registry.getEntry(name),
		isReadOnly: (name: string) => name === 'read_file',
	};

	let callCount = 0;
	const client = {
		chat: async () => {
			const toolCalls = toolCallTurns[callCount++];
			if (toolCalls) {
				return {choices: [{message: {content: '', tool_calls: toolCalls}}]};
			}
			await holdFinalAnswer;
			return {choices: [{message: {content: 'done'}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn: session.conn,
		nonInteractiveAlwaysAllow: [],
	});

	return session.messages
		.filter((m: any) => m.role === 'tool')
		.map((m: any) => String(m.content));
};

test.serial('runAcpConversation - tools resolve against the session cwd, not the agent launch directory', async t => {
	const project = createCwdProject(t, 'PROJECT');
	t.not(project, process.cwd());
	// A regression would write here; never leave it in the checkout.
	t.teardown(() =>
		rmSync(join(process.cwd(), 'created-by-agent.txt'), {force: true}),
	);

	const {conn} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo', cwd: project});
	const results = await runScriptedToolTurns(session, [
		[createMockToolCall('read_file', {path: 'marker.txt'}, 'call-read')],
		[
			createMockToolCall(
				'write_file',
				{path: 'created-by-agent.txt', content: 'hello\n'},
				'call-write',
			),
		],
		[createMockToolCall('execute_bash', {command: 'pwd'}, 'call-pwd')],
		[
			createMockToolCall(
				'write_file',
				{path: join(project, 'absolute.txt'), content: 'inside\n'},
				'call-absolute',
			),
		],
	]);

	t.true(results[0].includes('PROJECT marker'), results[0]);
	t.true(existsSync(join(project, 'created-by-agent.txt')));
	t.false(existsSync(join(process.cwd(), 'created-by-agent.txt')));
	t.true(results[2].includes(project), results[2]);
	t.true(
		existsSync(join(project, 'absolute.txt')),
		'an absolute path inside the session cwd is within the boundary',
	);
});

test.serial('runAcpConversation - a bash cd persists for the session and stays out of the process cwd', async t => {
	const project = createCwdProject(t, 'CD');
	mkdirSync(join(project, 'sub'));
	writeFileSync(join(project, 'sub', 'inner.txt'), 'inner file\n');

	const {conn} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo', cwd: project});
	const results = await runScriptedToolTurns(session, [
		[createMockToolCall('execute_bash', {command: 'cd sub'}, 'call-cd')],
		[createMockToolCall('read_file', {path: 'inner.txt'}, 'call-inner')],
	]);

	t.true(results[1].includes('inner file'), results[1]);
	t.is(getSessionCwd(), process.cwd(), 'the cd did not move the process-wide cwd');
});

test.serial('runAcpConversation - concurrent sessions keep their own working directories', async t => {
	const first = createCwdProject(t, 'FIRST');
	const second = createCwdProject(t, 'SECOND');

	const run = (cwd: string, id: string, holdFinalAnswer?: Promise<unknown>) => {
		const {conn} = createMockConn();
		const session = createMockSession(conn, {devMode: 'yolo', cwd});
		return runScriptedToolTurns(
			session,
			[[createMockToolCall('read_file', {path: 'marker.txt'}, id)]],
			holdFinalAnswer,
		);
	};
	// The first turn stays open until the second one ends, so both sessions
	// are mid-turn together. Ending in that order also keeps the per-turn
	// approval handler's LIFO restore intact for the tests that follow.
	let releaseFirst = () => {};
	const secondDone = new Promise<void>(resolveRelease => {
		releaseFirst = resolveRelease;
	});
	const firstRun = run(first, 'call-first', secondDone);
	const secondRun = run(second, 'call-second').finally(releaseFirst);
	const [firstResults, secondResults] = await Promise.all([
		firstRun,
		secondRun,
	]);

	t.true(firstResults[0].includes('FIRST marker'), firstResults[0]);
	t.true(secondResults[0].includes('SECOND marker'), secondResults[0]);
});

// ============================================================================
// session/set_mode during a turn (#1857)
// ============================================================================

// The client changes the mode at any point in a prompt, so the next model
// request and every later approval must follow it. Each turn below flips the
// mode while the model is "answering", which is after that request's tool list
// was built and before its calls are approved - the window the bug lived in.

const runModeSwitchTurn = async (
	t: any,
	devMode: DevelopmentMode,
	turns: Array<{toolCalls: ToolCall[]; switchTo?: DevelopmentMode}>,
	answer: 'allow' | 'deny' = 'deny',
	onUpdate?: (update: any, session: AcpSession) => void,
	alwaysAllow: string[] = [],
) => {
	const cwd = createCwdProject(t, 'MODE');
	const permissionRequests: any[] = [];
	const offered: string[][] = [];
	let session: AcpSession;
	const conn = {
		sessionUpdate: async (u: any) => onUpdate?.(u.update, session),
		requestPermission: async (p: any) => {
			permissionRequests.push(p);
			return {outcome: {outcome: 'selected', optionId: answer}};
		},
	} as unknown as AgentSideConnection;
	session = createMockSession(conn, {devMode, cwd});

	const registry = ToolRegistry.fromToolExports([readFileTool, writeFileTool]);
	setToolRegistryGetter(() => registry.getHandlers());
	const toolManager = {
		...createMockToolManager(),
		getAvailableToolNames: (_tune: unknown, mode: DevelopmentMode) =>
			mode === 'plan' ? ['read_file'] : ['read_file', 'write_file'],
		// What each model request is actually offered.
		getFilteredTools: (names: string[]) => {
			offered.push(names);
			return {};
		},
		hasTool: (name: string) => registry.hasTool(name),
		getToolEntry: (name: string) => registry.getEntry(name),
		isReadOnly: (name: string) => name === 'read_file',
	};

	let requests = 0;
	const client = {
		chat: async () => {
			const turn = turns[requests++];
			if (!turn) return {choices: [{message: {content: 'done'}}]};
			if (turn.switchTo) session.developmentMode = turn.switchTo;
			return {choices: [{message: {content: '', tool_calls: turn.toolCalls}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: alwaysAllow,
	});

	return {cwd, permissionRequests, offered, session};
};

const writeCall = (name: string, id: string) =>
	createMockToolCall('write_file', {path: name, content: 'x\n'}, id);

test.serial('runAcpConversation - a switch from yolo to normal mid-turn prompts for the next call', async t => {
	const {cwd, permissionRequests} = await runModeSwitchTurn(t, 'yolo', [
		{toolCalls: [writeCall('first.txt', 'call-1')]},
		{toolCalls: [writeCall('second.txt', 'call-2')], switchTo: 'normal'},
	]);

	t.deepEqual(
		permissionRequests.map(p => p.toolCall.toolCallId),
		['call-2'],
		'only the call after the switch is asked about',
	);
	t.true(existsSync(join(cwd, 'first.txt')));
	t.false(existsSync(join(cwd, 'second.txt')), 'the denied call must not run');
});

test.serial('runAcpConversation - a switch from normal to yolo mid-turn stops prompting', async t => {
	const {cwd, permissionRequests} = await runModeSwitchTurn(
		t,
		'normal',
		[
			{toolCalls: [writeCall('first.txt', 'call-1')]},
			{toolCalls: [writeCall('second.txt', 'call-2')], switchTo: 'yolo'},
		],
		'allow',
	);

	t.deepEqual(
		permissionRequests.map(p => p.toolCall.toolCallId),
		['call-1'],
	);
	t.true(existsSync(join(cwd, 'first.txt')));
	t.true(existsSync(join(cwd, 'second.txt')));
});

test.serial('runAcpConversation - the next model request offers the tools of the new mode', async t => {
	const {offered} = await runModeSwitchTurn(t, 'yolo', [
		{
			toolCalls: [createMockToolCall('read_file', {path: 'marker.txt'}, 'call-1')],
			switchTo: 'plan',
		},
	]);

	t.deepEqual(offered.slice(0, 2), [['read_file', 'write_file'], ['read_file']]);
});

test.serial('runAcpConversation - a call the model already returned is refused once the mode no longer offers it', async t => {
	// The batch was chosen in yolo; the switch to plan lands after its first call.
	const {cwd, permissionRequests, session} = await runModeSwitchTurn(
		t,
		'yolo',
		[
			{
				toolCalls: [
					createMockToolCall('read_file', {path: 'marker.txt'}, 'call-1'),
					writeCall('second.txt', 'call-2'),
				],
			},
		],
		'allow',
		(update, current) => {
			if (update.toolCallId === 'call-1' && update.status === 'completed') {
				current.developmentMode = 'plan';
			}
		},
	);

	t.is(permissionRequests.length, 0, 'refused before it is ever put to the user');
	t.false(existsSync(join(cwd, 'second.txt')));
	const refusal = session.messages.find(
		(m: any) => m.role === 'tool' && m.tool_call_id === 'call-2',
	);
	t.true(String(refusal?.content).includes('not available in plan mode'));
});

test.serial('runAcpConversation - a tool the plan mode never offered is refused even when the client would allow it', async t => {
	const {cwd, permissionRequests, session} = await runModeSwitchTurn(
		t,
		'plan',
		[{toolCalls: [writeCall('hidden.txt', 'call-1')]}],
		'allow',
	);

	t.is(permissionRequests.length, 0, 'never put to the user');
	t.false(existsSync(join(cwd, 'hidden.txt')));
	const refusal = session.messages.find(
		(m: any) => m.role === 'tool' && m.tool_call_id === 'call-1',
	);
	t.true(String(refusal?.content).includes('not available in plan mode'));
});

test.serial('runAcpConversation - alwaysAllow does not run a tool the plan mode never offered', async t => {
	const {cwd, permissionRequests} = await runModeSwitchTurn(
		t,
		'plan',
		[{toolCalls: [writeCall('hidden.txt', 'call-1')]}],
		'allow',
		undefined,
		['write_file'],
	);

	t.is(permissionRequests.length, 0);
	t.false(existsSync(join(cwd, 'hidden.txt')));
});

test.serial('runAcpConversation - a lone refused call is still announced to the client as failed', async t => {
	const updates: any[] = [];
	const {cwd, permissionRequests} = await runModeSwitchTurn(
		t,
		'yolo',
		[{toolCalls: [writeCall('only.txt', 'call-1')], switchTo: 'plan'}],
		'allow',
		update => updates.push(update),
	);

	t.is(permissionRequests.length, 0);
	t.false(existsSync(join(cwd, 'only.txt')));
	t.deepEqual(
		updates
			.filter(u => u.toolCallId === 'call-1')
			.map(u => [u.sessionUpdate, u.status]),
		[
			['tool_call', 'pending'],
			['tool_call_update', 'failed'],
		],
	);
});

test.serial('runAcpConversation - a prose plan is persisted after a switch into plan mode', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn, {devMode: 'normal'});
	const toolManager = {
		...createMockToolManager(),
		getAvailableToolNames: (_tune: unknown, mode: DevelopmentMode) =>
			mode === 'plan' ? ['read_file', 'write_plan'] : ['read_file'],
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};
	let persistedContent: unknown;
	setToolRegistryGetter(() => ({
		write_plan: async (args: unknown) => {
			persistedContent = (args as {content?: unknown}).content;
			return 'Plan saved';
		},
	}));
	const client = {
		chat: async () => {
			session.developmentMode = 'plan';
			return {choices: [{message: {content: '# Plan\n\n1. Build it.'}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(persistedContent, '# Plan\n\n1. Build it.');
});

test.serial('runAcpConversation - a mode switch in one session does not reach another', async t => {
	const [switched, untouched] = await Promise.all([
		runModeSwitchTurn(t, 'yolo', [
			{toolCalls: [writeCall('a.txt', 'call-a')], switchTo: 'normal'},
		]),
		runModeSwitchTurn(t, 'yolo', [{toolCalls: [writeCall('b.txt', 'call-b')]}]),
	]);

	t.is(switched.permissionRequests.length, 1);
	t.false(existsSync(join(switched.cwd, 'a.txt')));
	t.is(untouched.permissionRequests.length, 0);
	t.true(existsSync(join(untouched.cwd, 'b.txt')));
});

// ============================================================================
// Tools the client turned off for a session
// ============================================================================

/**
 * One turn in which the model calls `browser`. The tool manager honours the
 * disabled list it is given, as the real one does, and the registry counts how
 * many times the tool actually ran. With `turnOffWhileRequesting`, the client
 * turns `browser` off (as a session/load would) after the model was offered it
 * and before the call comes back.
 */
const runBrowserCallTurn = async (
	disabledTools: string[],
	{turnOffWhileRequesting = false} = {},
) => {
	const updates: any[] = [];
	const conn = {
		sessionUpdate: async (u: any) => {
			updates.push(u.update);
		},
		requestPermission: async () => ({
			outcome: {outcome: 'selected', optionId: 'allow'},
		}),
	} as unknown as AgentSideConnection;
	const session = createMockSession(conn, {devMode: 'yolo'});
	session.disabledTools = disabledTools;

	const offered: string[][] = [];
	let ran = 0;
	setToolRegistryGetter(() => ({
		browser: async () => {
			ran++;
			return 'page text';
		},
	}));
	const toolManager = {
		...createMockToolManager(),
		getAvailableToolNames: (
			_tune: unknown,
			_mode: unknown,
			disabled?: readonly string[],
		) => ['read_file', 'browser'].filter(name => !disabled?.includes(name)),
		getFilteredTools: (names: string[]) => {
			offered.push(names);
			return {};
		},
		hasTool: () => true,
		getToolEntry: () => ({approval: false}),
	};

	let requests = 0;
	const client = {
		chat: async () => {
			requests++;
			if (requests === 1 && turnOffWhileRequesting) {
				session.disabledTools = ['browser'];
			}
			return requests === 1
				? {
						choices: [
							{
								message: {
									content: '',
									tool_calls: [createMockToolCall('browser', {}, 'browse-1')],
								},
							},
						],
					}
				: {choices: [{message: {content: 'done'}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: toolManager as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	const toolResult = session.messages.findLast(
		(m: Message) => m.role === 'tool',
	);
	return {offered, ran, toolResult, updates, session};
};

test.serial('runAcpConversation - a tool the session turned off is not offered, and a call to it is refused', async t => {
	const {offered, ran, toolResult, updates} = await runBrowserCallTurn([
		'browser',
	]);

	t.deepEqual(offered[0], ['read_file']);
	// The model named it anyway: nothing ran, and it is told why.
	t.is(ran, 0);
	t.is(toolResult?.content, 'Error: browser is disabled in this session');
	const failed = updates.filter(
		(u: any) => u.toolCallId === 'browse-1' && u.status === 'failed',
	);
	t.is(failed.length, 1);
});

test.serial('runAcpConversation - a tool turned off while the model is answering is refused, not run', async t => {
	const {offered, ran, toolResult} = await runBrowserCallTurn([], {
		turnOffWhileRequesting: true,
	});

	// It was offered, because the list was empty when the request was made.
	t.deepEqual(offered[0], ['read_file', 'browser']);
	t.is(ran, 0);
	t.is(toolResult?.content, 'Error: browser is disabled in this session');
});

test.serial('runAcpConversation - another session in the same process still has the tool', async t => {
	const off = await runBrowserCallTurn(['browser']);
	const on = await runBrowserCallTurn([]);

	t.is(off.ran, 0);
	t.deepEqual(on.offered[0], ['read_file', 'browser']);
	t.is(on.ran, 1);
	t.is(on.toolResult?.content, 'page text');
});

test.serial('runAcpConversation - a session\'s subagents are told what the session turned off', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn);
	session.disabledTools = ['browser'];
	let fromBridge: readonly string[] | undefined;
	const client = {
		chat: async () => {
			fromBridge = getSubagentToolBridge(session.sessionId)?.getDisabledTools?.();
			return {choices: [{message: {content: 'done', tool_calls: []}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.deepEqual(fromBridge, ['browser']);
});

test.serial('runAcpConversation - a session\'s subagents get the client the turn runs on, and keep it if the session changes', async t => {
	const {conn} = createMockConn();
	const session = createMockSession(conn);
	let fromBridge: unknown;
	let fromBridgeAfterSwitch: unknown;
	const turnClient = {
		chat: async () => {
			fromBridge = getSubagentToolBridge(session.sessionId)?.getClient?.();
			// The session picks another model while this turn is running.
			session.client = {} as unknown as LLMClient;
			fromBridgeAfterSwitch = getSubagentToolBridge(session.sessionId)?.getClient?.();
			return {choices: [{message: {content: 'done', tool_calls: []}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client: turnClient,
		toolManager: createMockToolManager() as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});

	t.is(fromBridge, turnClient);
	// The running turn keeps its client, so its subagents do too.
	t.is(fromBridgeAfterSwitch, turnClient);
});

// ============================================================================
// Sub-agent lifecycle notifications
// ============================================================================

/**
 * One turn whose `agent` call plays a sub-agent run through the event store
 * the way the executor does, so only the ACP wiring is under test.
 */
const runAgentTurn = async (
	conn: AgentSideConnection,
	session: AcpSession,
	runId: string,
) => {
	let calls = 0;
	const client = {
		chat: async () => {
			calls++;
			return calls === 1
				? {
						choices: [
							{
								message: {
									content: '',
									tool_calls: [
										createMockToolCall('agent', {}, `agent-call-${runId}`),
									],
								},
							},
						],
					}
				: {choices: [{message: {content: 'done'}}]};
		},
	} as unknown as LLMClient;

	await runAcpConversation({
		session,
		client,
		toolManager: {...createMockToolManager(), hasTool: () => true} as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});
};

const subagentRegistry = () => {
	setToolRegistryGetter(() => ({
		agent: async (_args: any, options: any) => {
			const base = {
				childRunId: `run-${options.sessionId}`,
				parentRunId: '',
				sessionId: options.sessionId,
				toolCallId: options.toolCallId,
				name: 'explore',
			};
			emitSubagentRunEvent({...base, status: 'started'});
			await new Promise(resolve => setTimeout(resolve, 20));
			emitSubagentRunEvent({...base, status: 'progress', tokenCount: 5});
			// Another session's run, which this session must not be told about.
			emitSubagentRunEvent({
				...base,
				sessionId: 'someone-else',
				childRunId: 'run-someone-else',
				status: 'started',
			});
			emitSubagentRunEvent({...base, status: 'completed', result: 'found it'});
			return 'found it';
		},
	}));
};

const createNotifyingConn = () => {
	const notifications: Array<{method: string; params: any}> = [];
	const conn = {
		sessionUpdate: async () => {},
		requestPermission: async () => ({
			outcome: {outcome: 'selected', optionId: 'allow'},
		}),
		notify: async (method: string, params: any) => {
			notifications.push({method, params});
		},
	} as unknown as AgentSideConnection;
	return {conn, notifications};
};

test.serial('runAcpConversation - sends the sub-agent run to the client, tied to the agent call', async t => {
	subagentRegistry();
	const {conn, notifications} = createNotifyingConn();
	const session = createMockSession(conn, {devMode: 'yolo'});

	await runAgentTurn(conn, session, 'one');

	t.true(notifications.every(n => n.method === '_nanocoder/subagent'));
	t.deepEqual(
		notifications.map(n => n.params.status),
		['started', 'progress', 'completed'],
	);
	for (const {params} of notifications) {
		t.is(params.sessionId, session.sessionId);
		t.is(params.childRunId, `run-${session.sessionId}`);
		t.is(params.toolCallId, 'agent-call-one');
		t.is(params.parentRunId, '');
	}
	t.is(notifications.at(-1)?.params.result, 'found it');
});

test.serial('runAcpConversation - two sessions with sub-agents do not see each other\'s runs', async t => {
	subagentRegistry();
	const first = createNotifyingConn();
	const second = createNotifyingConn();
	const sessionA = createMockSession(first.conn, {devMode: 'yolo'});
	const sessionB = createMockSession(second.conn, {devMode: 'yolo'});

	await Promise.all([
		runAgentTurn(first.conn, sessionA, 'a'),
		runAgentTurn(second.conn, sessionB, 'b'),
	]);

	for (const [{notifications}, session] of [
		[first, sessionA],
		[second, sessionB],
	] as const) {
		t.is(notifications.length, 3);
		t.true(notifications.every(n => n.params.sessionId === session.sessionId));
	}
});

test.serial('runAcpConversation - a client that cannot take the notification still gets the turn', async t => {
	subagentRegistry();
	// The default mock connection has no notify(), so every send fails.
	const {conn, updates} = createMockConn();
	const session = createMockSession(conn, {devMode: 'yolo'});

	await runAgentTurn(conn, session, 'quiet');

	t.is(session.messages.findLast((m: Message) => m.role === 'tool')?.content, 'found it');
	t.true(updates.length > 0);
});

test.serial('runAcpConversation - stops listening when the turn ends', async t => {
	subagentRegistry();
	const {conn, notifications} = createNotifyingConn();
	const session = createMockSession(conn, {devMode: 'yolo'});
	await runAgentTurn(conn, session, 'ended');
	const before = notifications.length;

	emitSubagentRunEvent({
		childRunId: 'late',
		parentRunId: '',
		sessionId: session.sessionId,
		name: 'explore',
		status: 'started',
	});
	await new Promise(resolve => setTimeout(resolve, 20));

	t.is(notifications.length, before);
});

test.serial('runAcpConversation - a sub-agent permission request names the run', async t => {
	const {permissionRequests} = await callThroughBridge(
		async () => ({outcome: {outcome: 'selected', optionId: 'allow'}}),
		{subagentRunId: 'run-9'},
	);

	t.deepEqual(permissionRequests[0]._meta, {'nanocoder/childRunId': 'run-9'});
});

test.serial('runAcpConversation - a permission request without a run id carries no run meta', async t => {
	const {permissionRequests} = await callThroughBridge(async () => ({
		outcome: {outcome: 'selected', optionId: 'allow'},
	}));

	t.is(permissionRequests[0]._meta, undefined);
});

// ============================================================================
// Sub-agent runs through the real agent tool and executor
// ============================================================================

const subagentToolManager = () =>
	({
		filterToolNamesForMode: (names: string[]) => names,
		getOwnerSkill: () => undefined,
		getAllTools: () => ({}),
		getToolHandler: () => undefined,
		getToolEntry: () => undefined,
		isReadOnly: () => true,
		getToolFormatter: () => undefined,
		getStreamingFormatter: () => undefined,
	}) as unknown as ToolManager;

const startRealSubagents = async (subagentClient: LLMClient) => {
	await getSubagentLoader().initialize();
	setAgentToolExecutor(
		new SubagentExecutor(subagentToolManager(), subagentClient),
	);
	setToolRegistryGetter(() => ({
		agent: (args: any, options: any) => agentTool.tool.execute!(args, options),
	}));
};

/**
 * A turn whose model calls the `agent` tool. A sub-agent runs on the client the
 * turn runs on, so that client also answers the sub-agent's own request (the
 * second one) the way `subagentClient` would.
 */
const agentCallTurn = (
	session: AcpSession,
	conn: AgentSideConnection,
	subagentClient: LLMClient,
) => {
	let calls = 0;
	const client = {
		// What the sub-agent executor reads from the client it inherits from.
		getCurrentModel: () => subagentClient.getCurrentModel(),
		getProviderConfig: () => subagentClient.getProviderConfig(),
		chat: async (...args: unknown[]) => {
			calls++;
			if (calls === 2) {
				return (subagentClient.chat as (...a: unknown[]) => unknown)(...args);
			}
			return calls === 1
				? {
						choices: [
							{
								message: {
									content: '',
									tool_calls: [
										createMockToolCall(
											'agent',
											{subagent_type: 'explore', description: 'look'},
											'parent-agent-call',
										),
									],
								},
							},
						],
					}
				: {choices: [{message: {content: 'parent finished'}}]};
		},
	} as unknown as LLMClient;
	return runAcpConversation({
		session,
		client,
		toolManager: {...createMockToolManager(), hasTool: () => true} as any,
		conn,
		nonInteractiveAlwaysAllow: [],
	});
};

test.serial('runAcpConversation - a real sub-agent run reaches the client from start to completed', async t => {
	const subagentClient = {
		chat: async () => ({choices: [{message: {content: 'child answer'}}]}),
		getCurrentModel: () => 'm',
		getProviderConfig: () => ({name: 'p'}),
	} as unknown as LLMClient;
	await startRealSubagents(subagentClient);
	const {conn, notifications} = createNotifyingConn();
	const session = createMockSession(conn, {devMode: 'yolo'});

	const result = await agentCallTurn(session, conn, subagentClient);

	t.is(result.stopReason, 'end_turn');
	const statuses = notifications.map(n => n.params.status);
	t.is(statuses[0], 'started');
	t.is(statuses.at(-1), 'completed');
	t.is(notifications.at(-1)?.params.result, 'child answer');
	for (const {params} of notifications) {
		t.is(params.sessionId, session.sessionId);
		t.is(params.toolCallId, 'parent-agent-call');
		t.is(params.name, 'explore');
		t.is(params.parentRunId, '');
	}
	t.is(new Set(notifications.map(n => n.params.childRunId)).size, 1);
});

test.serial('runAcpConversation - cancelling one sub-agent lets the parent turn continue', async t => {
	let childModelCalled = false;
	const subagentClient = {
		chat: (_m: unknown, _t: unknown, _c: unknown, signal?: AbortSignal) =>
			new Promise((_resolve, reject) => {
				childModelCalled = true;
				// A real client rejects on a signal that is already aborted, so
				// this must too: a cancel can land before the call is made.
				const abort = () => reject(new Error('Aborted'));
				if (signal?.aborted) abort();
				else signal?.addEventListener('abort', abort);
			}),
		getCurrentModel: () => 'm',
		getProviderConfig: () => ({name: 'p'}),
	} as unknown as LLMClient;
	await startRealSubagents(subagentClient);
	const {conn, notifications} = createNotifyingConn();
	const session = createMockSession(conn, {devMode: 'yolo'});

	const turn = agentCallTurn(session, conn, subagentClient);
	// What a client does: wait for the run to be announced, then cancel it by id.
	const started = await waitFor(() =>
		notifications.find(n => n.params.status === 'started'),
	);
	await waitFor(() => (childModelCalled ? true : undefined));
	t.true(cancelSubagentRun(session.sessionId, started.params.childRunId));
	const result = await turn;

	t.is(result.stopReason, 'end_turn');
	t.false(session.abortController.signal.aborted);
	t.is(notifications.at(-1)?.params.status, 'cancelled');
	// The parent was told, so it can carry on rather than wait for a result.
	const toolResult = session.messages.findLast(
		(m: Message) => m.role === 'tool' && m.name === 'agent',
	);
	t.regex(String(toolResult?.content), /Subagent was cancelled/);
	t.is(session.messages.at(-1)?.content, 'parent finished');
});

async function waitFor<T>(find: () => T | undefined): Promise<T> {
	for (let i = 0; i < 100; i++) {
		const found = find();
		if (found) return found;
		await new Promise(resolve => setTimeout(resolve, 20));
	}
	throw new Error('timed out waiting');
}

test.serial('runAcpConversation - a session with its own tools runs them, and others still use the shared registry', async t => {
	const {conn} = createMockConn();
	const runTurn = async (sessionTools?: ToolManager) => {
		const session = createMockSession(conn, {devMode: 'yolo'});
		let calls = 0;
		const client = {
			chat: async () => {
				calls++;
				return calls === 1
					? {
							choices: [
								{
									message: {
										content: '',
										tool_calls: [createMockToolCall('lookup', {})],
									},
								},
							],
						}
					: {choices: [{message: {content: 'done'}}]};
			},
		} as unknown as LLMClient;
		await runAcpConversation({
			session,
			client,
			toolManager: {...createMockToolManager(), hasTool: () => true} as any,
			sessionTools,
			conn,
			nonInteractiveAlwaysAllow: [],
		});
		return String(
			session.messages.findLast((m: Message) => m.role === 'tool')?.content,
		);
	};
	setToolRegistryGetter(() => ({lookup: async () => 'shared registry'}));
	const own = {
		getToolRegistry: () => ({lookup: async () => 'session registry'}),
	} as unknown as ToolManager;

	t.is(await runTurn(own), 'session registry');
	t.is(await runTurn(), 'shared registry');
});
