import test from 'ava';
import type {AgentSideConnection} from '@agentclientprotocol/sdk';
import {AcpSession} from '@/acp/acp-session';
import {runAcpConversation} from '@/acp/acp-conversation';
import {
	setToolRegistryGetter,
	setToolManagerGetter,
} from '@/message-handler';
import type {
	LLMClient,
	ToolCall,
} from '@/types/core';

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
		devMode?: any;
		messages?: any[];
		systemMessage?: any;
		aborted?: boolean;
	} = {},
): AcpSession => {
	const session = new AcpSession({
		sessionId: 'test-session',
		cwd: '/tmp',
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

test('runAcpConversation - onReasoningToken sends agent_thought_chunk updates', async t => {
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
	capturedCallbacks.onReasoningToken('thinking...');

	const thoughtUpdates = updates.filter(
		(u: any) => u.update.sessionUpdate === 'agent_thought_chunk',
	);
	t.is(thoughtUpdates.length, 1);
	t.is(thoughtUpdates[0].update.content.text, 'thinking...');
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
						tool_calls: [createMockToolCall('dangerous_tool', {}, 'call-1')],
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
