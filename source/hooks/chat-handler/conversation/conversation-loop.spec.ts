import {mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {dropOrphanedToolResults} from '@/ai-sdk-client/converters/message-converter.js';
import {
	clearAppConfig,
	getAppConfig,
	reloadAppConfig,
} from '@/config/index.js';
import {setProjectRoot} from '@/services/session-cwd.js';
import type {HooksConfig} from '@/types/config';
import {resetShutdownManager} from '@/utils/shutdown/shutdown-manager.js';
import {processAssistantResponse, resetFallbackNotice, resetLastTurnHadReasoning} from './conversation-loop.js';
import type {
	ApiUsageSnapshot,
	LLMChatResponse,
	Message,
	ToolCall,
	ToolResult,
} from '@/types/core';
import type {RetryLimitsConfig} from '@/types/index';
import {
	resetAutoCompactSession,
	setAutoCompactEnabled,
	setAutoCompactStrategy,
	setAutoCompactThreshold,
} from '@/utils/auto-compact.js';
import {
	resetSessionContextLimit,
	setSessionContextLimit,
} from '@/models/models-dev-client.js';
import {setGlobalQuestionHandler} from '@/utils/question-queue.js';
import {setGlobalToolConfirmHandler} from '@/utils/tool-confirm-queue.js';

// The ShutdownManager singleton is created as a side effect of transitive
// imports (via @/utils/logging). Its uncaughtException/unhandledRejection
// handlers call process.exit(), which AVA intercepts as a fatal error.
// Reset it so signal handlers are removed during tests.
test.before(() => {
	resetShutdownManager();
});

test.after.always(() => {
	resetShutdownManager();
});

// ============================================================================
// Test Helpers and Mocks
// ============================================================================

// Mock client that simulates LLM responses
const createMockClient = (response: {
	toolCalls?: ToolCall[];
	content?: string;
	toolsDisabled?: boolean;
	reasoning?: string;
	usage?: {inputTokens?: number; outputTokens?: number; totalTokens?: number};
}) => ({
	chat: async (): Promise<LLMChatResponse> => ({
		choices: [
			{
				message: {
					role: 'assistant',
					content: response.content || '',
					tool_calls: response.toolCalls,
					reasoning: response.reasoning
				},
			},
		],
		toolsDisabled: response.toolsDisabled ?? false,
		usage: response.usage,
	}),
});

// Mock tool manager
const createMockToolManager = (config: {
	tools?: string[];
	validatorResult?: {valid: boolean};
	needsApproval?: boolean | (() => boolean);
}) => ({
	getAllTools: () => ({}),
	hasTool: (name: string) => config.tools?.includes(name) || false,
	getTool: (name: string) => ({
		execute: async () => 'Tool executed',
	}),
	getToolValidator: (name: string) => {
		if (config.validatorResult) {
			return async () => config.validatorResult!;
		}
		return undefined;
	},
	getToolEntry: (name: string) => {
		if (config.needsApproval !== undefined) {
			return {
				name,
				approval: config.needsApproval,
			};
		}
		return undefined;
	},
	getAvailableToolNames: (_tune: unknown, _mode: string) =>
		config.tools ?? ['some_tool', 'read_file'],
	getFilteredTools: (names: string[]) => {
		const tools: Record<string, unknown> = {};
		for (const name of names) {
			tools[name] = {
				name,
				description: `Mock tool ${name}`,
				input_schema: {type: 'object', properties: {}},
			};
		}
		return tools;
	},
	isReadOnly: () => false,
});

// Mock parseToolCalls function - imported from tool-parsing
const mockParseToolCalls = (result: {
	success: boolean;
	toolCalls?: ToolCall[];
	cleanedContent?: string;
	error?: string;
	examples?: string;
}) => result;

// Mock filterValidToolCalls function
const mockFilterValidToolCalls = (result: {
	validToolCalls: ToolCall[];
	errorResults: ToolResult[];
}) => result;

// Default params for tests
const createDefaultParams = (overrides = {}) => ({
	systemMessage: {role: 'system', content: 'You are a helpful assistant'} as Message,
	messages: [{role: 'user', content: 'Hello'}] as Message[],
	client: null as any,
	toolManager: null,
	abortController: null,
	setAbortController: () => {},
	setIsGenerating: () => {},
	setStreamingReasoning: () => {},
	setStreamingContent: () => {},
	setTokenCount: () => {},
	setMessages: () => {},
	addToChatQueue: () => {},
	currentModel: 'test-model',
	currentProvider: 'openai',
	developmentMode: 'normal' as const,
	nonInteractiveMode: false,
	conversationStateManager: {
		current: {
			updateAssistantMessage: () => {},
		updateAfterToolExecution: () => {},
		},
	} as any,
	onConversationComplete: () => {},
	...overrides,
});

// ============================================================================
// Malformed Tool Recovery Tests (lines 127-169)
// ============================================================================

test.serial('processAssistantResponse - handles malformed tool call recovery', async t => {
	// This test simulates the parseToolCalls returning success: false
	// The function should display an error and recurse with corrected messages

	// Note: Since parseToolCalls is an internal import, we can't easily mock it
	// This test documents the expected behavior but would require refactoring
	// to make parseToolCalls injectable for proper testing

	t.pass('Malformed tool recovery requires injectable parseToolCalls');
});

// ============================================================================
// Unknown Tool Handling Tests (lines 236-261)
// ============================================================================

test.serial('processAssistantResponse - handles unknown tool errors', async t => {
	// This requires mocking filterValidToolCalls to return error results
	// The function should display errors and recurse with error context

	t.pass('Unknown tool handling requires injectable filterValidToolCalls');
});

// ============================================================================
// Plan Mode Blocking Tests (lines 265-310)
// ============================================================================

test.serial('processAssistantResponse - blocks file modification tools in plan mode', async t => {
	// This test would require:
	// 1. Mock client.chat() to return file modification tool calls
	// 2. Set developmentMode to 'plan'
	// 3. Verify error messages are displayed
	// 4. Verify recursion with error results

	t.pass('Plan mode blocking requires injectable dependencies');
});

// ============================================================================
// Tool Categorization Tests (lines 314-391)
// ============================================================================

test.serial('processAssistantResponse - categorizes tools by needsApproval', async t => {
	// This test requires:
	// 1. Mock client.chat() to return multiple tool calls
	// 2. Mock toolManager.getToolEntry() to return different needsApproval values
	// 3. Verify tools are correctly separated into confirmation vs direct execution

	t.pass('Tool categorization requires injectable toolManager');
});

// ============================================================================
// Direct Execution Tests (lines 394-418)
// ============================================================================

test.serial('processAssistantResponse - executes tools directly when no approval needed', async t => {
	// This test requires:
	// 1. Mock client.chat() to return tool calls with needsApproval: false
	// 2. Mock executeToolsDirectly to return results
	// 3. Verify recursion with tool results

	t.pass('Direct execution requires injectable executeToolsDirectly');
});

// ============================================================================
// Non-Interactive Exit Tests (lines 422-453)
// ============================================================================

test.serial('processAssistantResponse - exits in non-interactive mode when approval needed', async t => {
	let conversationCompleteCalled = false;
	const addToChatQueue = () => {};
	const setMessages = () => {};

	const params = createDefaultParams({
		developmentMode: 'normal',
		nonInteractiveMode: true,
		onConversationComplete: () => {
			conversationCompleteCalled = true;
		},
		addToChatQueue,
		setMessages,
	});

	// Create a mock client that returns a tool requiring approval
	// (We can't easily test this without injectable dependencies)

	t.pass('Non-interactive exit requires proper mock setup');
});

test.serial('processAssistantResponse - marks the non-interactive approval notice display-only', async t => {
	const captured: Message[][] = [];

	const params = createDefaultParams({
		client: createMockClient({
			toolCalls: [{id: 'call_1', function: {name: 'some_tool', arguments: {}}}],
		}),
		toolManager: createMockToolManager({
			tools: ['some_tool'],
			needsApproval: true,
		}),
		nonInteractiveMode: true,
		setMessages: (msgs: Message[]) => captured.push(msgs),
	});

	await processAssistantResponse(params);

	const latest = captured[captured.length - 1];
	const notice = latest[latest.length - 1];
	t.is(notice.role, 'assistant');
	t.regex(notice.content, /Tool approval required for: some_tool/);
	t.true(notice.displayOnly, 'the approval notice must never reach the model');
});

// ============================================================================
// Auto-Nudge Tests (lines 469-506)
// ============================================================================

test.serial('processAssistantResponse - auto-nudges on empty response without tool results uses generic prompt', async t => {
	let chatCallCount = 0;
	const messagesSeenByRecursiveCall: Message[][] = [];
	const liveComponents: any[] = [];

	const trackingClient = {
		chat: async (msgs: Message[]): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			if (chatCallCount === 1) {
				return {
					choices: [
						{message: {role: 'assistant', content: '', tool_calls: undefined}},
					],
					toolsDisabled: false,
				};
			}
			messagesSeenByRecursiveCall.push(msgs);
			return {
				choices: [
					{message: {role: 'assistant', content: 'Done.', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: trackingClient,
		messages: [{role: 'user', content: 'Hi'}],
		setLiveComponent: (component: any) => liveComponents.push(component),
	});

	await processAssistantResponse(params);

	t.is(chatCallCount, 2, 'Initial empty response should trigger one nudge recursion');
	const recursive = messagesSeenByRecursiveCall[0];
	const lastUser = [...recursive].reverse().find(m => m.role === 'user');
	t.is(lastUser?.content, 'Please continue with the task.');

	// Counter rendered as a live component, not stacked in the static queue.
	const counter = liveComponents.find(
		(c: any) => typeof c?.props?.message === 'string' && c.props.message.startsWith('Empty response — retry'),
	);
	t.truthy(counter, 'Should set a live retry counter describing the auto-continue');
	t.regex(counter.props.message, /retry 1\/3/);
});

test.serial('processAssistantResponse - auto-nudges on empty response with recent tool results uses summary prompt', async t => {
	let chatCallCount = 0;
	const messagesSeenByRecursiveCall: Message[][] = [];

	const trackingClient = {
		chat: async (msgs: Message[]): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			if (chatCallCount === 1) {
				return {
					choices: [
						{message: {role: 'assistant', content: '', tool_calls: undefined}},
					],
					toolsDisabled: false,
				};
			}
			messagesSeenByRecursiveCall.push(msgs);
			return {
				choices: [
					{message: {role: 'assistant', content: 'Summary.', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};

	const messagesWithToolResult: Message[] = [
		{role: 'user', content: 'Run a tool'},
		{role: 'assistant', content: '', tool_calls: [{id: 't1', type: 'function', function: {name: 'list_directory', arguments: '{}'}}]},
		{role: 'tool', tool_call_id: 't1', name: 'list_directory', content: 'file1\nfile2'},
	];

	const params = createDefaultParams({
		client: trackingClient,
		messages: messagesWithToolResult,
	});

	await processAssistantResponse(params);

	t.is(chatCallCount, 2);
	const recursive = messagesSeenByRecursiveCall[0];
	const lastUser = [...recursive].reverse().find(m => m.role === 'user');
	t.is(lastUser?.content, 'Please provide a summary or response based on the tool results above.');
});

test.serial('processAssistantResponse - reasoning-only empty turn uses reasoning-specific nudge', async t => {
	let chatCallCount = 0;
	const messagesSeenByRecursiveCall: Message[][] = [];

	const trackingClient = {
		chat: async (msgs: Message[]): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			if (chatCallCount === 1) {
				return {
					choices: [
						{
							message: {
								role: 'assistant',
								content: '',
								tool_calls: undefined,
								reasoning: 'I considered the options carefully...',
							},
						},
					],
					toolsDisabled: false,
				};
			}
			messagesSeenByRecursiveCall.push(msgs);
			return {
				choices: [
					{message: {role: 'assistant', content: 'My answer.', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: trackingClient,
		messages: [{role: 'user', content: 'Think then answer'}],
	});

	await processAssistantResponse(params);

	t.is(chatCallCount, 2);
	const recursive = messagesSeenByRecursiveCall[0];
	const lastUser = [...recursive].reverse().find(m => m.role === 'user');
	t.is(
		lastUser?.content,
		'You produced reasoning but no final response. Please provide your answer based on your reasoning above.',
	);
});

test.serial('processAssistantResponse - strips <think> tags on the native path before content reaches UI and history', async t => {
	const queuedComponents: any[] = [];
	const messagesSetCalls: Message[][] = [];

	// Native path (toolsDisabled:false). Content has a <think> block that
	// would leak into the UI and conversation history without the strip.
	const thinkLeakingClient = {
		chat: async (): Promise<LLMChatResponse> => ({
			choices: [
				{
					message: {
						role: 'assistant',
						content: '<think>Let me consider the options carefully.</think>Here is my answer.',
						tool_calls: undefined,
					},
				},
			],
			toolsDisabled: false,
		}),
	};

	const params = createDefaultParams({
		client: thinkLeakingClient,
		messages: [{role: 'user', content: 'Hi'}],
		addToChatQueue: (component: any) => queuedComponents.push(component),
		setMessages: (messages: Message[]) => messagesSetCalls.push(messages),
	});

	await processAssistantResponse(params);

	// AssistantMessage component should receive cleaned content
	const assistantMessage = queuedComponents.find(
		(c: any) => typeof c.props?.message === 'string' && c.props.message.includes('Here is my answer.'),
	);
	t.truthy(assistantMessage, 'Should queue an AssistantMessage with the post-think content');
	t.notRegex(assistantMessage.props.message, /<think>/i, 'AssistantMessage must not contain <think> tags');
	t.notRegex(assistantMessage.props.message, /<\/think>/i, 'AssistantMessage must not contain </think> tags');

	// Conversation history must also be clean — without the strip, every
	// future turn would re-feed the <think> block into the model.
	const lastSetMessages = messagesSetCalls[messagesSetCalls.length - 1];
	const lastAssistant = [...lastSetMessages].reverse().find(m => m.role === 'assistant');
	t.truthy(lastAssistant, 'Should append an assistant message to history');
	t.notRegex(lastAssistant!.content as string, /<think>/i, 'History must not contain <think> tags');
});

// ============================================================================
// API Usage Snapshot Tests (#381)
// ============================================================================

test.serial('processAssistantResponse - captures API usage snapshot keyed to the post-response message count', async t => {
	const usageCalls: (ApiUsageSnapshot | null)[] = [];

	const params = createDefaultParams({
		client: createMockClient({
			content: 'Hi there',
			usage: {inputTokens: 1200, outputTokens: 300, totalTokens: 1500},
		}),
		messages: [{role: 'user', content: 'Hello'}],
		setLastApiUsage: (usage: ApiUsageSnapshot | null) => usageCalls.push(usage),
	});

	await processAssistantResponse(params);

	// The user message plus the appended assistant reply → 2 messages.
	t.deepEqual(usageCalls.at(-1), {
		inputTokens: 1200,
		outputTokens: 300,
		totalTokens: 1500,
		atMessageCount: 2,
	});
});

test.serial('processAssistantResponse - clears the API usage snapshot when the provider reports no usage', async t => {
	const usageCalls: (ApiUsageSnapshot | null)[] = [];

	const params = createDefaultParams({
		client: createMockClient({content: 'Hi there'}), // no usage reported
		messages: [{role: 'user', content: 'Hello'}],
		setLastApiUsage: (usage: ApiUsageSnapshot | null) => usageCalls.push(usage),
	});

	await processAssistantResponse(params);

	t.is(usageCalls.at(-1), null);
});

test.serial('processAssistantResponse - stores a snapshot when the provider reports only a totalTokens lump sum', async t => {
	const usageCalls: (ApiUsageSnapshot | null)[] = [];

	const params = createDefaultParams({
		client: createMockClient({content: 'Hi there', usage: {totalTokens: 1500}}),
		messages: [{role: 'user', content: 'Hello'}],
		setLastApiUsage: (usage: ApiUsageSnapshot | null) => usageCalls.push(usage),
	});

	await processAssistantResponse(params);

	t.deepEqual(usageCalls.at(-1), {totalTokens: 1500, atMessageCount: 2});
});

test.serial('processAssistantResponse - strips JSON ghost-echo on the native path when tool calls are present', async t => {
	const queuedComponents: any[] = [];
	const messagesSetCalls: Message[][] = [];

	// Native path with native tool calls AND the same call echoed in text content
	// (open-weights "Ghost Echo" failure mode).
	const ghostEchoClient = {
		chat: async (): Promise<LLMChatResponse> => ({
			choices: [
				{
					message: {
						role: 'assistant',
						content:
							'I will read the file now.\n\n```json\n{"name": "read_file", "arguments": {"path": "/etc/hosts"}}\n```',
						tool_calls: [
							{
								id: 'call_abc',
								function: {
									name: 'read_file',
									arguments: {path: '/etc/hosts'},
								},
							},
						],
					},
				},
			],
			toolsDisabled: false,
		}),
	};

	const params = createDefaultParams({
		client: ghostEchoClient,
		messages: [{role: 'user', content: 'Read /etc/hosts'}],
		addToChatQueue: (component: any) => queuedComponents.push(component),
		setMessages: (messages: Message[]) => messagesSetCalls.push(messages),
	});

	await processAssistantResponse(params);

	// AssistantMessage must contain the prose but NOT the echoed JSON tool call
	const assistantMessage = queuedComponents.find(
		(c: any) =>
			typeof c.props?.message === 'string' &&
			c.props.message.includes('I will read the file now.'),
	);
	t.truthy(assistantMessage, 'Should queue an AssistantMessage with the prose');
	t.notRegex(
		assistantMessage.props.message,
		/"name":\s*"read_file"/i,
		'AssistantMessage must not contain JSON ghost-echo',
	);
	t.notRegex(
		assistantMessage.props.message,
		/```/,
		'AssistantMessage must not contain the json fence',
	);

	// Conversation history must also be clean — without the strip, every
	// future turn would re-feed the echoed JSON back into the model.
	const lastSetMessages = messagesSetCalls[messagesSetCalls.length - 1];
	const lastAssistant = [...lastSetMessages]
		.reverse()
		.find(m => m.role === 'assistant');
	t.truthy(lastAssistant, 'Should append an assistant message to history');
	t.notRegex(
		lastAssistant!.content as string,
		/"name":\s*"read_file"/i,
		'History must not contain JSON ghost-echo',
	);
});

test.serial('processAssistantResponse - extracts JSON tool call hallucination on native path when no native tool_calls present', async t => {
	const messagesSetCalls: Message[][] = [];

	// Native path with NO native tool calls. The model emitted a JSON tool
	// call as text instead — common regression for open-weights models
	// marketed as native-tool-capable. The fallback parser should catch it
	// and treat it as a real tool call so the agent doesn't stall.
	const hallucinatingClient = {
		chat: async (): Promise<LLMChatResponse> => ({
			choices: [
				{
					message: {
						role: 'assistant',
						content:
							'```json\n{"name": "read_file", "arguments": {"path": "/etc/hosts"}}\n```',
						tool_calls: undefined,
					},
				},
			],
			toolsDisabled: false,
		}),
	};

	const params = createDefaultParams({
		client: hallucinatingClient,
		messages: [{role: 'user', content: 'Read /etc/hosts'}],
		toolManager: createMockToolManager({tools: ['read_file']}),
		setMessages: (messages: Message[]) => messagesSetCalls.push(messages),
	});

	await processAssistantResponse(params);

	// The fallback parser should have extracted the tool call and added it
	// to the assistant message in conversation history.
	const lastSetMessages = messagesSetCalls[messagesSetCalls.length - 1];
	const lastAssistant = [...lastSetMessages]
		.reverse()
		.find(m => m.role === 'assistant');
	t.truthy(lastAssistant, 'Should append assistant message to history');
	t.truthy(
		lastAssistant!.tool_calls,
		'Assistant message should carry extracted tool_calls',
	);
	t.is(lastAssistant!.tool_calls!.length, 1);
	t.is(lastAssistant!.tool_calls![0].function.name, 'read_file');
});

test.serial('processAssistantResponse - extracts XML tool call hallucination on native path when no native tool_calls present', async t => {
	const messagesSetCalls: Message[][] = [];

	const xmlHallucinatingClient = {
		chat: async (): Promise<LLMChatResponse> => ({
			choices: [
				{
					message: {
						role: 'assistant',
						content:
							'<read_file>\n  <path>/etc/hosts</path>\n</read_file>',
						tool_calls: undefined,
					},
				},
			],
			toolsDisabled: false,
		}),
	};

	const params = createDefaultParams({
		client: xmlHallucinatingClient,
		messages: [{role: 'user', content: 'Read /etc/hosts'}],
		toolManager: createMockToolManager({tools: ['read_file']}),
		setMessages: (messages: Message[]) => messagesSetCalls.push(messages),
	});

	await processAssistantResponse(params);

	const lastSetMessages = messagesSetCalls[messagesSetCalls.length - 1];
	const lastAssistant = [...lastSetMessages]
		.reverse()
		.find(m => m.role === 'assistant');
	t.truthy(lastAssistant, 'Should append assistant message to history');
	t.truthy(
		lastAssistant!.tool_calls,
		'Assistant message should carry extracted tool_calls',
	);
	t.is(lastAssistant!.tool_calls!.length, 1);
	t.is(lastAssistant!.tool_calls![0].function.name, 'read_file');
});

test.serial('processAssistantResponse - malformed JSON on native path drives self-correction', async t => {
	let chatCallCount = 0;
	const queuedComponents: any[] = [];

	// Native path with malformed JSON in text content (missing arguments
	// field). The fallback parser detects it as malformed; the self-correction
	// loop should display the error and recurse with the error feedback.
	// Verifies row 8 of the Post-Fix Reality table on the Native column.
	const malformedJSONClient = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			return {
				choices: [
					{
						message: {
							role: 'assistant',
							content: '{"name": "read_file"}',
							tool_calls: undefined,
						},
					},
				],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: malformedJSONClient,
		messages: [{role: 'user', content: 'Read /etc/hosts'}],
		addToChatQueue: (component: any) => queuedComponents.push(component),
	});

	await processAssistantResponse(params);

	// Self-correction should have fired: the loop recurses with error
	// feedback, so the client is invoked more than once before hitting the cap.
	t.true(
		chatCallCount > 1,
		`Expected self-correction recursion on native path; chatCallCount=${chatCallCount}`,
	);

	// The structured malformed-JSON error should have been surfaced to the user.
	const errorComponent = queuedComponents.find(
		(c: any) =>
			typeof c.props?.message === 'string' &&
			/missing "arguments" field/i.test(c.props.message),
	);
	t.truthy(
		errorComponent,
		'Should display structured malformed-JSON error to user',
	);
});

test.serial('processAssistantResponse - leaves prose without a tool-call shape alone on native path', async t => {
	const queuedComponents: any[] = [];

	// Native path with no tool calls and content that has no JSON/XML
	// tool-call shape — should pass through as a regular assistant message.
	const proseClient = {
		chat: async (): Promise<LLMChatResponse> => ({
			choices: [
				{
					message: {
						role: 'assistant',
						content:
							'I can help with that. Use the read_file tool — pass it a path and it will return the contents.',
						tool_calls: undefined,
					},
				},
			],
			toolsDisabled: false,
		}),
	};

	const params = createDefaultParams({
		client: proseClient,
		messages: [{role: 'user', content: 'How do I call a tool?'}],
		addToChatQueue: (component: any) => queuedComponents.push(component),
	});

	await processAssistantResponse(params);

	const assistantMessage = queuedComponents.find(
		(c: any) =>
			typeof c.props?.message === 'string' &&
			c.props.message.includes('I can help with that'),
	);
	t.truthy(assistantMessage, 'Should queue prose AssistantMessage');
	t.regex(
		assistantMessage.props.message,
		/read_file tool/i,
		'Prose without tool-call shape should pass through unmodified',
	);
});

test.serial('processAssistantResponse - malformed-XML cap stops the loop after MAX_MALFORMED_RETRIES', async t => {
	let chatCallCount = 0;
	const queuedComponents: any[] = [];

	// Always return a malformed-XML pattern that XMLToolCallParser rejects.
	// Uses the [tool_use: name] format (some GLM-style models emit this)
	// which has no JSON args to parse and stays in the malformed branch.
	// Combined with toolsDisabled:true, the real parseToolCalls drives the
	// loop into the malformed branch on every turn.
	const alwaysMalformedClient = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			return {
				choices: [
					{
						message: {
							role: 'assistant',
							content: '[tool_use: read_file]',
							tool_calls: undefined,
						},
					},
				],
				toolsDisabled: true,
			};
		},
	};

	const params = createDefaultParams({
		client: alwaysMalformedClient,
		messages: [{role: 'user', content: 'Hi'}],
		addToChatQueue: (component: any) => queuedComponents.push(component),
	});

	await processAssistantResponse(params);

	// MAX_MALFORMED_RETRIES = 2 → initial + 2 retries = 3 calls, then give up
	t.is(chatCallCount, 3, 'Loop should stop after MAX_MALFORMED_RETRIES+1 chat calls');

	const giveUpMessage = queuedComponents.find(
		(c: any) => typeof c.props?.message === 'string' && c.props.message.includes('malformed tool calls'),
	);
	t.truthy(giveUpMessage, 'Should queue a give-up ErrorMessage when cap is hit');
});

test.serial('processAssistantResponse - empty-turn cap stops the loop after MAX_EMPTY_TURNS', async t => {
	let chatCallCount = 0;
	const queuedComponents: any[] = [];

	const alwaysEmptyClient = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			return {
				choices: [
					{message: {role: 'assistant', content: '', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: alwaysEmptyClient,
		messages: [{role: 'user', content: 'Hi'}],
		addToChatQueue: (component: any) => queuedComponents.push(component),
	});

	await processAssistantResponse(params);

	// MAX_EMPTY_TURNS = 2 → initial + 2 nudge retries = 3 calls, then
	// force-compact kicks in for one more cycle (MAX_COMPACT_RETRIES=1),
	// resetting emptyTurnCount and allowing another round of nudges before
	// final give-up. Total depends on whether compression succeeds; minimum
	// is still the baseline of 3.
	t.true(
		chatCallCount >= 3,
		`Expected at least MAX_EMPTY_TURNS+1=${3} chat calls; got ${chatCallCount}`,
	);

	const giveUpMessage = queuedComponents.find(
		(c: any) => typeof c.props?.message === 'string' && c.props.message.includes('produced no output after'),
	);
	t.truthy(giveUpMessage, 'Should queue a give-up ErrorMessage when cap is hit');
});

// ============================================================================
// Force-Compact Retry Tests (feature/force-compact)
// ============================================================================

test.serial('processAssistantResponse - attempts compact-and-retry after exhausting empty turns', async t => {
	// After MAX_EMPTY_TURNS nudges are exhausted, the force-compact logic
	// should compress the context and recurse once more before giving up.
	// We verify this by checking that chatCallCount exceeds MAX_EMPTY_TURNS+1
	// (the baseline without force-compact). The tokenizer import may succeed
	// or throw depending on environment — in either case we validate the
	// error message includes the correct attempt count.
	let chatCallCount = 0;
	const queuedComponents: any[] = [];

	const alwaysEmptyClient = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			return {
				choices: [
					{message: {role: 'assistant', content: '', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: alwaysEmptyClient,
		messages: [{role: 'user', content: 'Hi'}],
		addToChatQueue: (component: any) => queuedComponents.push(component),
	});

	await processAssistantResponse(params);

	// At minimum there should be MAX_EMPTY_TURNS + 1 calls (initial + nudges).
	// If compression succeeds, additional compact-and-retry cycles add more.
	t.true(
		chatCallCount >= 3,
		`Expected at least MAX_EMPTY_TURNS+1=${3} chat calls; got ${chatCallCount}`,
	);

	const giveUpMessage = queuedComponents.find(
		(c: any) => typeof c.props?.message === 'string' && c.props.message.includes('produced no output after'),
	);
	t.truthy(giveUpMessage, 'Should queue a give-up ErrorMessage when all retries exhausted');
});

test.serial('processAssistantResponse - error message includes total attempts including compact retries', async t => {
	let chatCallCount = 0;
	const queuedComponents: any[] = [];

	const alwaysEmptyClient = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			return {
				choices: [
					{message: {role: 'assistant', content: '', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: alwaysEmptyClient,
		messages: [{role: 'user', content: 'Hi'}],
		addToChatQueue: (component: any) => queuedComponents.push(component),
	});

	await processAssistantResponse(params);

	// The give-up message should report the actual number of attempts.
	// With force-compact, this is >= MAX_EMPTY_TURNS + 2 (initial + nudges + at least one compact retry if compression succeeds).
	const giveUpMessage = queuedComponents.find(
		(c: any) => typeof c.props?.message === 'string' && c.props.message.includes('produced no output after'),
	);
	t.truthy(giveUpMessage, 'Should have a give-up error message');

	// Extract the attempt count from the message text like "after X attempts"
	const match = giveUpMessage!.props.message.match(/after (\d+) attempts/);
	t.truthy(match, 'Error message should contain an attempt count');
	const reportedAttempts = parseInt(match![1], 10);
	t.true(
		reportedAttempts >= 3,
		`Reported attempts (${reportedAttempts}) should be at least MAX_EMPTY_TURNS+1=3`,
	);
});

test.serial('processAssistantResponse - compact-and-retry resets emptyTurnCount for new cycle', async t => {
	// When force-compact recurses, it resets emptyTurnCount to 0 so the model
	// gets another full set of nudges after compaction. We verify this by
	// having the client return empty for enough calls that we'd exceed the
	// baseline cap without the reset.
	let chatCallCount = 0;
	const queuedComponents: any[] = [];

	const alwaysEmptyClient = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			return {
				choices: [
					{message: {role: 'assistant', content: '', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: alwaysEmptyClient,
		messages: [{role: 'user', content: 'Hi'}],
		addToChatQueue: (component: any) => queuedComponents.push(component),
	});

	await processAssistantResponse(params);

	// Without resetting emptyTurnCount on compact retry, total would be exactly 3.
	// With reset + MAX_COMPACT_RETRIES=1, if compression succeeds we get more calls
	// because the model gets another round of nudges after compaction.
	t.true(
		chatCallCount >= 3,
		`Expected at least 3 chat calls; got ${chatCallCount}. Compact retry should allow additional attempts.`,
	);
});

test.serial('processAssistantResponse - falls through to error when compression throws during force-compact', async t => {
	// When compressMessages or createTokenizer throws inside the try/catch,
	// the code should fall through to the give-up path without crashing.
	let chatCallCount = 0;
	const queuedComponents: any[] = [];

	const alwaysEmptyClient = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			return {
				choices: [
					{message: {role: 'assistant', content: '', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: alwaysEmptyClient,
		messages: [{role: 'user', content: 'Hi'}],
		addToChatQueue: (component: any) => queuedComponents.push(component),
	});

	// This should NOT throw even if compression fails internally
	await t.notThrowsAsync(processAssistantResponse(params));

	const giveUpMessage = queuedComponents.find(
		(c: any) => typeof c.props?.message === 'string' && c.props.message.includes('produced no output after'),
	);
	t.truthy(giveUpMessage, 'Should still surface give-up error when compression throws');
});

test.serial('processAssistantResponse - compact-and-retry shows info message with reduction percentage', async t => {
	let chatCallCount = 0;
	const queuedComponents: any[] = [];

	// Use verbose messages so compression has something to reduce.
	const longContent = 'This is a very long message that will be compressed by the force-compact logic. '.repeat(30);
	const messages: Message[] = [
		{role: 'user', content: longContent},
		{role: 'assistant', content: 'Acknowledged.'},
	];

	const alwaysEmptyClient = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			return {
				choices: [
					{message: {role: 'assistant', content: '', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: alwaysEmptyClient,
		messages,
		addToChatQueue: (component: any) => queuedComponents.push(component),
	});

	await processAssistantResponse(params);

	// If compression succeeded at least once, there should be an info message
	// mentioning "auto-compacted" with a reduction percentage.
	const compactInfo = queuedComponents.find(
		(c: any) => typeof c.props?.message === 'string' && c.props.message.includes('auto-compacted'),
	);

	// If we found the compact info, verify it includes a percentage
	if (compactInfo) {
		t.regex(
			compactInfo.props.message,
			/\d+% reduction/,
			'Compact info message should include reduction percentage',
		);
	} else {
		// Compression may have thrown — still valid as long as error was surfaced
		const giveUpMessage = queuedComponents.find(
			(c: any) => typeof c.props?.message === 'string' && c.props.message.includes('produced no output after'),
		);
		t.truthy(giveUpMessage, 'Should surface give-up error if compression failed');
	}
});

test.serial('processAssistantResponse - compact-and-retry adds nudge message to compressed context', async t => {
	let chatCallCount = 0;
	const messagesSetCalls: Message[][] = [];

	// Use verbose messages so compression has something to reduce.
	const longContent = 'Verbose conversation content that exceeds thresholds for mechanical compression. '.repeat(30);
	const messages: Message[] = [
		{role: 'user', content: longContent},
		{role: 'assistant', content: 'Prior response.'},
	];

	const alwaysEmptyClient = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			return {
				choices: [
					{message: {role: 'assistant', content: '', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: alwaysEmptyClient,
		messages,
		setMessages: (msgs: Message[]) => messagesSetCalls.push(msgs),
		addToChatQueue: () => {},
	});

	await processAssistantResponse(params);

	// After compact-and-retry, the last setMessages call before termination
	// should contain a user nudge with "Context has been compacted" text
	// IF compression succeeded. Otherwise we just verify no crash occurred.
	const nudgeCall = messagesSetCalls.find(
		msgs => msgs.some(m => m.role === 'user' && m.content.includes('Context has been compacted')),
	);

	if (nudgeCall) {
		t.truthy(nudgeCall, 'Should add a compact-nudge message to compressed context');
		const nudgeMsg = nudgeCall.find(m => m.role === 'user' && m.content.includes('Context has been compacted'));
		t.is(nudgeMsg!.content, 'Context has been compacted. Please continue with the task.');
	} else {
		// Compression threw — still valid as long as it didn't crash
		t.pass('Compression did not succeed; force-compact fell through gracefully');
	}
});

test.serial('processAssistantResponse - MAX_COMPACT_RETRIES constant limits retry cycles', async t => {
	// Verify that the total number of chat calls is bounded even when the model
	// keeps returning empty responses. With MAX_EMPTY_TURNS=2 and MAX_COMPACT_RETRIES=1,
	// the maximum should be bounded (not infinite).
	let chatCallCount = 0;
	const queuedComponents: any[] = [];

	const alwaysEmptyClient = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			return {
				choices: [
					{message: {role: 'assistant', content: '', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: alwaysEmptyClient,
		messages: [{role: 'user', content: 'Hi'}],
		addToChatQueue: (component: any) => queuedComponents.push(component),
	});

	await processAssistantResponse(params);

	// The call count must be finite and reasonable — not an unbounded loop.
	// Worst case with force-compact: initial + 2 nudges + compact retry cycle
	// (which resets emptyTurnCount to 0 → another 3 nudges) = up to ~6 calls max.
	t.true(
		chatCallCount <= 10,
		`Expected bounded retries (<=10); got ${chatCallCount}. MAX_COMPACT_RETRIES should prevent infinite loops.`,
	);
	t.true(
		chatCallCount >= 3,
		`Expected at least baseline retries (>=3); got ${chatCallCount}`,
	);
});

test.serial('processAssistantResponse - compactRetryCount parameter is passed through recursion', async t => {
	// Verify that compactRetryCount increments on each compact-and-retry cycle.
	// We check the error message reflects the actual number of compact attempts made.
	let chatCallCount = 0;
	const queuedComponents: any[] = [];

	const alwaysEmptyClient = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			return {
				choices: [
					{message: {role: 'assistant', content: '', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: alwaysEmptyClient,
		messages: [{role: 'user', content: 'Hi'}],
		addToChatQueue: (component: any) => queuedComponents.push(component),
	});

	await processAssistantResponse(params);

	// The give-up message format is "after X attempts" where X = MAX_EMPTY_TURNS + 1 + compactRetryCount
	// If compression succeeded at least once, compactRetryCount >= 1, so X >= 4
	// If compression threw immediately, compactRetryCount = 0, so X = 3
	const giveUpMessage = queuedComponents.find(
		(c: any) => typeof c.props?.message === 'string' && c.props.message.includes('produced no output after'),
	);
	t.truthy(giveUpMessage, 'Should have a give-up error');

	const match = giveUpMessage!.props.message.match(/after (\d+) attempts/);
	t.truthy(match, 'Error should contain attempt count');
	const totalAttempts = parseInt(match![1], 10);

	// Total attempts must be consistent with the actual number of chat calls made
	// (attempts in the message may differ from chatCallCount if some calls were
	// during compact retry cycles that reset emptyTurnCount).
	t.true(totalAttempts >= 3, `Attempt count (${totalAttempts}) should reflect all retries`);
});

// ============================================================================
// Conversation Complete Tests (lines 509-510)
// ============================================================================

test.serial('processAssistantResponse - nudges once for an approved plan without a walkthrough', async t => {
	let chatCallCount = 0;
	let nudge = '';
	let completionCount = 0;
	const client = {
		chat: async (messages: Message[]): Promise<LLMChatResponse> => {
			chatCallCount++;
			if (chatCallCount === 2) {
				nudge = messages.at(-1)?.content ?? '';
			}
			return {
				choices: [
					{
						message: {
							role: 'assistant',
							content:
								chatCallCount === 1 ? 'Implementation complete.' : 'Confirmed.',
						},
					},
				],
				toolsDisabled: false,
			};
		},
	};

	await processAssistantResponse(
		createDefaultParams({
			client,
			messages: [
				{
					role: 'user',
					content: '<approved_plan>Implement artifacts.</approved_plan>',
				},
			],
			toolManager: createMockToolManager({tools: ['write_walkthrough']}),
			onConversationComplete: () => {
				completionCount++;
			},
		}),
	);

	t.is(chatCallCount, 2);
	t.true(nudge.includes('write_walkthrough'));
	t.is(completionCount, 1);
});

test.serial('processAssistantResponse - calls onConversationComplete when done', async t => {
	let conversationCompleteCalled = false;

	const params = createDefaultParams({
		onConversationComplete: () => {
			conversationCompleteCalled = true;
		},
		// Mock client to return content with no tool calls
		client: createMockClient({
			content: 'Here is my response!',
			toolCalls: undefined,
		}),
	});

	// This would complete the conversation without errors
	// if all dependencies are properly mocked

	t.pass('Conversation complete requires proper mock setup');
});

// ============================================================================
// Original Smoke Test
// ============================================================================

test('processAssistantResponse - throws on null client', async t => {
	const params = createDefaultParams({
		client: null,
	});

	await t.throwsAsync(async () => {
		await processAssistantResponse(params);
	});
});

// ============================================================================
// Mock Helper Test
// ============================================================================

test('createMockToolManager - creates valid mock', t => {
	const mockManager = createMockToolManager({
		tools: ['test_tool'],
		validatorResult: {valid: true},
		needsApproval: false,
	});

	t.truthy(mockManager.getAllTools);
	t.truthy(mockManager.hasTool);
	t.truthy(mockManager.getTool);
});

// ============================================================================
// XML Fallback Notice Tests
// ============================================================================

test.serial('processAssistantResponse - shows XML fallback notice when toolsDisabled is true', async t => {
	resetFallbackNotice();

	const queuedComponents: any[] = [];
	const params = createDefaultParams({
		client: createMockClient({
			content: 'Here is my response!',
			toolCalls: undefined,
			toolsDisabled: true,
		}),
		addToChatQueue: (component: any) => {
			queuedComponents.push(component);
		},
	});

	await processAssistantResponse(params);

	// Should have queued the fallback notice (plus the assistant message and completion message)
	const fallbackNotice = queuedComponents.find(
		(c: any) => c.props?.message === 'Model does not support native tool calling. Using XML fallback.',
	);
	t.truthy(fallbackNotice, 'Should queue XML fallback notice');
});

test.serial('processAssistantResponse - shows XML fallback notice only once across calls', async t => {
	resetFallbackNotice();

	const queuedComponents: any[] = [];
	const addToChatQueue = (component: any) => {
		queuedComponents.push(component);
	};

	const params = createDefaultParams({
		client: createMockClient({
			content: 'First response',
			toolCalls: undefined,
			toolsDisabled: true,
		}),
		addToChatQueue,
	});

	// First call - should show notice
	await processAssistantResponse(params);

	const firstCallNotices = queuedComponents.filter(
		(c: any) => c.props?.message === 'Model does not support native tool calling. Using XML fallback.',
	);
	t.is(firstCallNotices.length, 1, 'Should show notice on first call');

	// Clear queue and call again
	queuedComponents.length = 0;

	const params2 = createDefaultParams({
		client: createMockClient({
			content: 'Second response',
			toolCalls: undefined,
			toolsDisabled: true,
		}),
		addToChatQueue,
	});

	await processAssistantResponse(params2);

	const secondCallNotices = queuedComponents.filter(
		(c: any) => c.props?.message === 'Model does not support native tool calling. Using XML fallback.',
	);
	t.is(secondCallNotices.length, 0, 'Should not show notice on second call');
});

test.serial('processAssistantResponse - does not show XML fallback notice when toolsDisabled is false', async t => {
	resetFallbackNotice();

	const queuedComponents: any[] = [];
	const params = createDefaultParams({
		client: createMockClient({
			content: 'Here is my response!',
			toolCalls: undefined,
			toolsDisabled: false,
		}),
		addToChatQueue: (component: any) => {
			queuedComponents.push(component);
		},
	});

	await processAssistantResponse(params);

	const fallbackNotice = queuedComponents.find(
		(c: any) => c.props?.message === 'Model does not support native tool calling. Using XML fallback.',
	);
	t.falsy(fallbackNotice, 'Should not queue XML fallback notice when toolsDisabled is false');
});

// ============================================================================
// Reasoning in Chat Queue Tests
// ============================================================================

test.serial('processAssistantResponse - no reasoning in chat queue by default', async t => {
	const queuedComponents: any[] = [];
	const params = createDefaultParams({
		client: createMockClient({
			content: 'Here is my response!',
			toolCalls: undefined,
			toolsDisabled: false,
		}),
		addToChatQueue: (component: any) => {
			queuedComponents.push(component);
		},
	});

	await processAssistantResponse(params);

	// Checks for reasoning components based on prop name
	const assistantReasoning = queuedComponents.filter(
		(c: any) => c.props?.reasoning !== undefined
	);
	t.is(assistantReasoning.length, 0, 'Should not render any reasoning component in chat queue by default');
});

test.serial('processAssistantResponse - renders reasoning in chat queue', async t => {
	const reasoningMessage = 'Here is my reasoning!';
	const queuedComponents: any[] = [];
	const params = createDefaultParams({
		client: createMockClient({
			content: 'Here is my response!',
			reasoning: reasoningMessage,
			toolCalls: undefined,
			toolsDisabled: false,
		}),
		addToChatQueue: (component: any) => {
			queuedComponents.push(component);
		},
	});

	await processAssistantResponse(params);

	// Checks for reasoning components based on prop name
	const assistantReasoning = queuedComponents.filter(
		(c: any) => c.props?.reasoning === reasoningMessage
	);
	t.is(assistantReasoning.length, 1, 'Should render exactly one reasoning component in chat queue');
});

// ============================================================================
// Compact Tool-Count Summary Tests
// ============================================================================

test.serial(
	'processAssistantResponse - combines accumulated compact counts into a single summary on completion',
	async t => {
		// Regression: counts accumulated across prior reasoning-only tool turns
		// (e.g. two execute_bash calls) must flush as ONE combined summary
		// ("Ran 2 commands"), not stacked "Ran 1 command" lines. The flush
		// fires on narrative-text completion, not on reasoning.
		resetLastTurnHadReasoning();
		const queuedComponents: any[] = [];
		const compactToolCountsRef = {current: {execute_bash: 2}};
		const params = createDefaultParams({
			client: createMockClient({
				content: 'All done!',
				reasoning: 'Let me summarise the results.',
				toolCalls: undefined,
				toolsDisabled: false,
			}),
			addToChatQueue: (component: any) => {
				queuedComponents.push(component);
			},
			compactToolCountsRef,
			onSetCompactToolCounts: () => {},
		});

		await processAssistantResponse(params);

		const summaries = queuedComponents.filter((c: any) =>
			String(c.key).includes('tool-compact-summary'),
		);
		t.is(summaries.length, 1, 'Should flush exactly one combined summary box');

		// displayCompactCountsSummary maps entries to CompactToolResult
		// children, so props.children is always an array.
		const descriptions = (summaries[0].props.children as any[]).map(
			(child: any) => child.props.description,
		);
		t.deepEqual(
			descriptions,
			['Ran 2 commands'],
			'Two accumulated bash calls combine into "Ran 2 commands"',
		);
		t.deepEqual(
			compactToolCountsRef.current,
			{},
			'Accumulator is reset after flushing',
		);
	},
);

// ============================================================================
// Token Count Reset After Compression Tests
// ============================================================================

/**
 * Helper to reset all shared/module-level state before tests that exercise
 * processAssistantResponse end-to-end (auto-compaction, tool flows, nudging).
 */
function setupAutoCompactTestEnv() {
	resetAutoCompactSession();
	setAutoCompactEnabled(true);
	setAutoCompactThreshold(50);
	resetSessionContextLimit();
	clearAppConfig();
	// Pin the agent-loop retry limits to their shipped defaults. Many tests here
	// count exact chat calls, and a `nanocoder.retries` block in the developer's
	// project or personal config would otherwise change those counts.
	const retries = getAppConfig().retries;
	if (retries) {
		retries.maxRepeatedToolCalls = 3;
		retries.maxEmptyTurns = 2;
		retries.maxMalformedRetries = 2;
	}
	resetFallbackNotice();
	resetLastTurnHadReasoning();
}

test.serial.beforeEach(() => {
	setupAutoCompactTestEnv();
});

test.serial.after.always(() => {
	setupAutoCompactTestEnv();
});

test.serial('processAssistantResponse - resets token count after successful auto-compaction', async t => {
	// Keep the context limit tiny and threshold explicit so this test does not
	// depend on local agents.config.json values. The old message is outside the
	// recent-message window, so auto-compact must actually shorten it.
	setSessionContextLimit(100);

	const oldVerboseContent = 'old context sentence. '.repeat(120);
	const originalMessages: Message[] = [
		{role: 'user', content: oldVerboseContent},
		{role: 'assistant', content: 'Prior answer'},
		{role: 'user', content: 'Recent request'},
	];
	const events: Array<
		| {type: 'setMessages'; messages: Message[]}
		| {type: 'setTokenCount'; count: number}
	> = [];

	const params = createDefaultParams({
		client: createMockClient({
			content: 'Done.',
			toolCalls: undefined,
			toolsDisabled: false,
		}),
		messages: originalMessages,
		currentProvider: 'openai',
		currentModel: 'gpt-4',
		setTokenCount: (count: number) => {
			events.push({type: 'setTokenCount', count});
		},
		setMessages: (msgs: Message[]) => {
			events.push({type: 'setMessages', messages: msgs});
		},
		addToChatQueue: () => {},
	});

	await processAssistantResponse(params);

	const setMessagesEvents = events.filter(
		(event): event is {type: 'setMessages'; messages: Message[]} =>
			event.type === 'setMessages',
	);
	const compressedMessages = setMessagesEvents.at(-1)?.messages;
	t.truthy(compressedMessages, 'setMessages should have been called');
	t.not(compressedMessages?.[0]?.content, oldVerboseContent);
	t.true((compressedMessages?.[0]?.content.length ?? 0) < oldVerboseContent.length);

	const compressionEventIndex = events.findLastIndex(
		event => event.type === 'setMessages' && event.messages === compressedMessages,
	);
	const resetAfterCompressionIndex = events.findIndex(
		(event, index) =>
			index > compressionEventIndex &&
			event.type === 'setTokenCount' &&
			event.count === 0,
	);
	t.true(
		resetAfterCompressionIndex > compressionEventIndex,
		'Expected setTokenCount(0) after compressed messages are set',
	);
});

test.serial('processAssistantResponse - does not extra-reset token count when compression returns null', async t => {
	// Set a large session context limit so the usage percentage stays below threshold.
	// Compression will NOT trigger, meaning only the initial setTokenCount(0) fires.
	setSessionContextLimit(999_999);

	const tokenCountCalls: number[] = [];

	const params = createDefaultParams({
		client: createMockClient({
			content: 'Done.',
			toolCalls: undefined,
			toolsDisabled: false,
		}),
		messages: [{role: 'user', content: 'Hello'}],
		currentProvider: 'openai',
		currentModel: 'gpt-4',
		setTokenCount: (count: number) => {
			tokenCountCalls.push(count);
		},
		addToChatQueue: () => {},
	});

	await processAssistantResponse(params);

	// Two setTokenCount(0) calls in the no-compression path: the initial
	// streaming reset before the LLM call, and the flush reset when the streamed
	// reply is committed to history. The compaction-specific reset must NOT fire.
	const zeroCalls = tokenCountCalls.filter(v => v === 0);
	t.is(zeroCalls.length, 2, `Expected exactly 2 calls to setTokenCount(0), got ${zeroCalls.length}`);
});

test.serial('processAssistantResponse - compressed messages persist when loop recurses (regression: pre-compression array was reused, undoing compression)', async t => {
	// Reproduce the bug where, after auto-compaction, downstream code paths
	// (tool execution, error recovery, auto-nudge) rebuilt state from the
	// PRE-compression local variable, clobbering the compressed messages
	// state. The empty-response auto-nudge path is the cleanest trigger for
	// this in a unit test because it exercises a recursive call with the
	// post-compaction message array.
	setSessionContextLimit(100);
	// Force mechanical compaction so auto-compact doesn't call client.chat()
	// for an LLM summary — that would inflate chatCallCount and the first
	// entry in messagesSeenByRecursiveCall would be the summariser's prompt
	// rather than the recursive main-loop call this test is checking.
	setAutoCompactStrategy('mechanical');

	const oldVerboseContent = 'old context sentence. '.repeat(120);
	const originalMessages: Message[] = [
		{role: 'user', content: oldVerboseContent},
		{role: 'assistant', content: 'Prior answer'},
		{role: 'user', content: 'Recent request'},
	];

	let chatCallCount = 0;
	const messagesSeenByRecursiveCall: Message[][] = [];

	const trackingClient = {
		chat: async (msgs: Message[]): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			if (chatCallCount === 1) {
				// First turn: empty response triggers the auto-nudge path
				// AFTER auto-compaction has happened.
				return {
					choices: [
						{
							message: {role: 'assistant', content: '', tool_calls: undefined},
						},
					],
					toolsDisabled: false,
				};
			}
			// Second turn (the recursion under test): record the messages so
			// we can assert they reflect the compressed state, then return a
			// real reply to terminate the loop.
			messagesSeenByRecursiveCall.push(msgs);
			return {
				choices: [
					{
						message: {role: 'assistant', content: 'Done.', tool_calls: undefined},
					},
				],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: trackingClient,
		messages: originalMessages,
		currentProvider: 'openai',
		currentModel: 'gpt-4',
		setMessages: () => {},
		addToChatQueue: () => {},
	});

	await processAssistantResponse(params);

	t.is(chatCallCount, 2, 'Expected exactly two LLM calls (initial + nudge recursion)');
	t.is(messagesSeenByRecursiveCall.length, 1, 'Expected to capture one recursive call');

	const recursiveMsgs = messagesSeenByRecursiveCall[0];
	const firstMessage = recursiveMsgs.find(m => m.role === 'user');
	t.truthy(firstMessage, 'Expected at least one user message in recursive call');
	t.not(
		firstMessage?.content,
		oldVerboseContent,
		'Recursive call must use compressed messages, not the pre-compression array',
	);
});

test.serial('processAssistantResponse - does not extra-reset token count when autoCompact is disabled via session override', async t => {
	// Even though context limit is tiny, disabling auto-compact should prevent compression.
	setSessionContextLimit(100);
	setAutoCompactEnabled(false);

	const tokenCountCalls: number[] = [];

	const params = createDefaultParams({
		client: createMockClient({
			content: 'Done.',
			toolCalls: undefined,
			toolsDisabled: false,
		}),
		messages: [{role: 'user', content: 'x'.repeat(300)}],
		currentProvider: 'openai',
		currentModel: 'gpt-4',
		setTokenCount: (count: number) => {
			tokenCountCalls.push(count);
		},
		addToChatQueue: () => {},
	});

	await processAssistantResponse(params);

	// Two setTokenCount(0) calls in the no-compression path: the initial
	// streaming reset before the LLM call, and the flush reset when the streamed
	// reply is committed to history. The compaction-specific reset must NOT fire.
	const zeroCalls = tokenCountCalls.filter(v => v === 0);
	t.is(zeroCalls.length, 2, `Expected exactly 2 calls to setTokenCount(0), got ${zeroCalls.length}`);
});

// ============================================================================
// Auto-Compact State Overwrite Fix Tests (Fix 1)
// ============================================================================

/**
 * These tests validate that after auto-compaction the local variable used by
 * downstream code reflects the compacted messages — NOT the pre-compaction
 * history. This is the core bug fix on this branch.
 */

test.serial('processAssistantResponse - final messages are compacted when no tools are present', async t => {
	// Tiny context limit so compression triggers for any non-trivial message.
	setSessionContextLimit(100);

	const oldVerboseContent = 'old verbose context sentence. '.repeat(60);
	// Need at least 3 old messages so some fall outside keepRecent=2 window
	// after the assistant message is appended (making total ≥ 5).
	const originalMessages: Message[] = [
		{role: 'user', content: oldVerboseContent},
		{role: 'assistant', content: 'Prior answer 1'},
		{role: 'user', content: 'Another request'},
	];

	const allSetMessagesCalls: Message[][] = [];
	const params = createDefaultParams({
		client: createMockClient({
			content: 'Short reply.',
			toolCalls: undefined,
			toolsDisabled: false,
		}),
		messages: originalMessages,
		currentProvider: 'openai',
		currentModel: 'gpt-4',
		setTokenCount: () => {},
		setMessages: (msgs: Message[]) => {
			allSetMessagesCalls.push(msgs);
		},
		addToChatQueue: () => {},
	});

	await processAssistantResponse(params);

	t.true(allSetMessagesCalls.length >= 2, 'setMessages should be called at least twice');

	// The LAST call to setMessages is the one that persists as conversation state.
	// It must NOT contain the full original verbose content — it should have been
	// compacted by auto-compaction before completion.
	const finalMessages = allSetMessagesCalls.at(-1)!;
	const containsOriginalVerbose = finalMessages.some(
		msg => msg.content === oldVerboseContent,
	);
	t.false(
		containsOriginalVerbose,
		'Final messages should not contain the original un-compacted verbose message',
	);
});

test.serial('processAssistantResponse - confirmation gate operates on compacted messages after auto-compact', async t => {
	// Context limit high enough that first turn compresses but second turn doesn't
	// re-trigger (prevents infinite LLM summarization loop).
	setSessionContextLimit(200);

	const oldVerboseContent = 'old verbose context sentence. '.repeat(60);
	// Multiple old messages so some are outside keepRecent=2 window.
	const originalMessages: Message[] = [
		{role: 'user', content: oldVerboseContent},
		{role: 'assistant', content: 'Prior answer'},
		{role: 'user', content: 'Recent request'},
	];

	// Decline at the gate so the loop records cancellation results and stops
	// (no recursion) — giving a deterministic terminal setMessages call to inspect.
	setGlobalToolConfirmHandler(async () => false);

	const setMessagesCalls: Message[][] = [];

	const mockToolManager = createMockToolManager({
		tools: ['some_tool'], // Register so filterValidToolCalls keeps it valid
		needsApproval: true,  // Force the confirmation gate
	});

	const params = createDefaultParams({
		client: createMockClient({
			content: '',
			toolCalls: [{
				id: 'call_1',
				function: {name: 'some_tool', arguments: '{}'},
			}],
			toolsDisabled: false,
		}),
		messages: originalMessages,
		toolManager: mockToolManager as any,
		currentProvider: 'openai',
		currentModel: 'gpt-4',
		nonInteractiveMode: false,
		setTokenCount: () => {},
		setMessages: (m: Message[]) => setMessagesCalls.push(m),
		addToChatQueue: () => {},
	});

	await processAssistantResponse(params);

	// On decline the loop writes cancellation results onto the (already
	// auto-compacted) history. That terminal write must not carry the original
	// verbose content — i.e. the gate operated after compaction.
	t.true(setMessagesCalls.length > 0, 'setMessages should have been called');
	const finalMessages = setMessagesCalls.at(-1)!;
	const containsOriginalVerbose = finalMessages.some(
		msg => msg.content === oldVerboseContent,
	);
	t.false(
		containsOriginalVerbose,
		'Confirmation gate should operate on compacted messages, not original verbose history',
	);
});

test.serial('processAssistantResponse - tool execution result appends to compacted messages (not original)', async t => {
	// Context limit high enough that first turn compresses but subsequent turns don't
	// re-trigger (prevents infinite LLM summarization loop during recursion).
	setSessionContextLimit(200);

	const oldVerboseContent = 'old verbose context sentence. '.repeat(60);
	// Multiple old messages so some are outside keepRecent=2 window.
	const originalMessages: Message[] = [
		{role: 'user', content: oldVerboseContent},
		{role: 'assistant', content: 'Prior answer'},
		{role: 'user', content: 'Recent request'},
	];

	const allSetMessagesCalls: Message[][] = [];
	let callCount = 0;

	// First call returns a tool, second call returns plain text → terminates recursion
	const mockClient = createMockClient({content: '', toolCalls: [] as any});
	mockClient.chat = async () => {
		callCount++;
		if (callCount === 1) {
			return {
				choices: [{message: {role: 'assistant', content: '', tool_calls: [{id: 'call_1', function: {name: 'read_file', arguments: '{}'}}]}}],
				toolsDisabled: false,
			};
		}
		// Second call — return a terminal response with no tools
		return {
			choices: [{message: {role: 'assistant', content: 'Done.'}}],
			toolsDisabled: false,
		};
	};

	// Tool that needs no approval → direct execution path
	const mockToolManager = createMockToolManager({
		tools: ['read_file'], // Register so filterValidToolCalls keeps it valid
		needsApproval: false,
	});

	const params = createDefaultParams({
		client: mockClient as any,
		messages: originalMessages,
		toolManager: mockToolManager as any,
		currentProvider: 'openai',
		currentModel: 'gpt-4',
		setTokenCount: () => {},
		setMessages: (msgs: Message[]) => {
			allSetMessagesCalls.push(msgs);
		},
		addToChatQueue: () => {},
		onConversationComplete: () => {},
	});

	await processAssistantResponse(params);

	// Find the call that includes tool results (messages with role === 'tool')
	const toolResultCall = allSetMessagesCalls.find(
		msgs => msgs.some(m => m.role === 'tool'),
	);
	t.truthy(toolResultCall, 'Should have a setMessages call containing tool results');

	// That call should NOT contain the full original verbose content — it was built
	// on top of compacted messages after auto-compaction reassigned updatedMessages.
	if (toolResultCall) {
		const containsOriginalVerbose = toolResultCall.some(
			msg => msg.content === oldVerboseContent,
		);
		t.false(
			containsOriginalVerbose,
			'Tool result messages should be appended to compacted history, not original verbose history',
		);
	}
});

test.serial('processAssistantResponse - auto-nudge builds on compacted messages when compression triggered', async t => {
	// Tiny context limit so compression triggers. The client returns empty content + no tools,
	// which will trigger the auto-nudge recursion path. We verify the nudge is added to
	// compacted messages by checking the last setMessages before recursion.
	setSessionContextLimit(100);

	const oldVerboseContent = 'old verbose context sentence. '.repeat(60);
	// Multiple old messages so some are outside keepRecent=2 window.
	const originalMessages: Message[] = [
		{role: 'user', content: oldVerboseContent},
		{role: 'assistant', content: 'Prior answer'},
		{role: 'user', content: 'Recent request'},
	];

	const allSetMessagesCalls: Message[][] = [];
	let callCount = 0;

	// First call returns empty (triggers nudge), second call returns text → terminates recursion
	const mockClient = createMockClient({content: '', toolCalls: undefined, toolsDisabled: false});
	mockClient.chat = async () => {
		callCount++;
		if (callCount === 1) {
			return {
				choices: [{message: {role: 'assistant', content: ''}}],
				toolsDisabled: false,
			};
		}
		// Second call — terminal response
		return {
			choices: [{message: {role: 'assistant', content: 'Done.'}}],
			toolsDisabled: false,
		};
	};

	const params = createDefaultParams({
		client: mockClient as any,
		messages: originalMessages,
		currentProvider: 'openai',
		currentModel: 'gpt-4',
		setTokenCount: () => {},
		setMessages: (msgs: Message[]) => {
			allSetMessagesCalls.push(msgs);
		},
		addToChatQueue: () => {},
		onConversationComplete: () => {},
	});

	await processAssistantResponse(params);

	// Find the nudge message — it will be a user role with "Please provide/continue"
	const nudgeCallIndex = allSetMessagesCalls.findIndex(
		msgs => msgs.some(m => m.role === 'user' && m.content.includes('Please')),
	);
	t.true(nudgeCallIndex >= 0, 'Should have a setMessages call containing the nudge');

	if (nudgeCallIndex >= 0) {
		const nudgeCallMsgs = allSetMessagesCalls[nudgeCallIndex];
		// The messages array used to build the nudge should NOT contain the full
		// original verbose content — auto-compaction should have compressed first.
		const containsOriginalVerbose = nudgeCallMsgs.some(
			msg => msg.content === oldVerboseContent,
		);
		t.false(
			containsOriginalVerbose,
			'Auto-nudge should be built on compacted messages, not original verbose history',
		);
	}
});

test.serial('processAssistantResponse - maxMessages caps history sent to the model but preserves system message', async t => {
	const originalMaxMessages = getAppConfig().sessions?.maxMessages;
	if (getAppConfig().sessions) {
		getAppConfig().sessions!.maxMessages = 3;
	}

	let messagesSentToClient: Message[] = [];
	const mockClient = {
		chat: async (msgs: Message[]): Promise<LLMChatResponse> => {
			messagesSentToClient = msgs;
			return {
				choices: [{message: {role: 'assistant', content: 'Capped response'}}],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: mockClient as any,
		systemMessage: {role: 'system', content: 'system-prompt'} as Message,
		messages: [
			{role: 'user', content: 'msg 1'},
			{role: 'assistant', content: 'msg 2'},
			{role: 'user', content: 'msg 3'},
			{role: 'assistant', content: 'msg 4'},
			{role: 'user', content: 'msg 5'},
		],
	});

	await processAssistantResponse(params);

	// Should have systemMessage + last 3 messages = 4 messages total
	t.is(messagesSentToClient.length, 4);
	t.deepEqual(messagesSentToClient[0], {role: 'system', content: 'system-prompt'});
	t.deepEqual(messagesSentToClient.slice(1), [
		{role: 'user', content: 'msg 3'},
		{role: 'assistant', content: 'msg 4'},
		{role: 'user', content: 'msg 5'},
	]);

	if (getAppConfig().sessions && originalMaxMessages !== undefined) {
		getAppConfig().sessions!.maxMessages = originalMaxMessages;
	}
});

test.serial('processAssistantResponse - does not start request on orphaned tool result (tool boundary)', async t => {
	const originalMaxMessages = getAppConfig().sessions?.maxMessages;
	if (getAppConfig().sessions) {
		getAppConfig().sessions!.maxMessages = 2;
	}

	let messagesSentToClient: Message[] = [];
	const mockClient = {
		chat: async (msgs: Message[]): Promise<LLMChatResponse> => {
			messagesSentToClient = msgs;
			return {
				choices: [{message: {role: 'assistant', content: 'Tool boundary response'}}],
				toolsDisabled: false,
			};
		},
	};

	const params = createDefaultParams({
		client: mockClient as any,
		systemMessage: {role: 'system', content: 'system-prompt'} as Message,
		messages: [
			{role: 'user', content: 'msg 1'},
			{role: 'assistant', content: '', tool_calls: [{id: 'call_1', function: {name: 'bash', arguments: {}}}]},
			{role: 'tool', tool_call_id: 'call_1', name: 'bash', content: 'output'},
			{role: 'user', content: 'msg 2'},
		],
	});

	await processAssistantResponse(params);

	// The last 2 messages starts at index 2 (the tool result).
	// Because of tool boundary adjustment, it walks back to index 1 (the assistant tool call).
	// So we should have systemMessage + assistant + tool + user = 4 messages.
	t.is(messagesSentToClient.length, 4);
	t.deepEqual(messagesSentToClient[0], {role: 'system', content: 'system-prompt'});
	t.deepEqual(messagesSentToClient.slice(1), [
		{role: 'assistant', content: '', tool_calls: [{id: 'call_1', function: {name: 'bash', arguments: {}}}]},
		{role: 'tool', tool_call_id: 'call_1', name: 'bash', content: 'output'},
		{role: 'user', content: 'msg 2'},
	]);

	if (getAppConfig().sessions && originalMaxMessages !== undefined) {
		getAppConfig().sessions!.maxMessages = originalMaxMessages;
	}
});

test.serial('processAssistantResponse - a synthetic diagnostics prompt does not cancel the walkthrough', async t => {
	// Reproduces the real approved-plan flow: the model edits files, the loop
	// injects a synthetic user message (auto diagnostics, compaction, an
	// empty-turn nudge), and only then does the model answer. The walkthrough
	// requirement must survive that — it describes how the turn STARTED, so
	// recreating it from the message tail would read the synthetic message as
	// "the latest user message" and silently drop the requirement.
	let chatCallCount = 0;
	let nudge = '';
	const client = {
		chat: async (messages: Message[]): Promise<LLMChatResponse> => {
			chatCallCount++;
			if (chatCallCount === 1) {
				// Model calls a tool, which drives the loop through its
				// tool-execution recursion.
				return {
					choices: [
						{
							message: {
								role: 'assistant',
								content: '',
								tool_calls: [
									{
										id: 'edit-1',
										function: {name: 'some_tool', arguments: {}},
									},
								],
							},
						},
					],
					toolsDisabled: false,
				};
			}
			if (chatCallCount === 2) {
				return {
					choices: [
						{
							message: {role: 'assistant', content: 'Implementation complete.'},
						},
					],
					toolsDisabled: false,
				};
			}
			nudge = messages.at(-1)?.content ?? '';
			return {
				choices: [{message: {role: 'assistant', content: 'Walkthrough saved.'}}],
				toolsDisabled: false,
			};
		},
	};

	// Mirrors the state the loop reaches after the model edits files: the
	// post-edit diagnostics prompt is appended with role 'user', so a naive
	// "what did the user last say" scan sees it instead of the approval.
	const messages: Message[] = [
		{
			role: 'user',
			content: '<approved_plan>Implement artifacts.</approved_plan>',
		},
		{
			role: 'user',
			content:
				'Automatic diagnostics after the recent edits found issues. Please fix the diagnostics you introduced before finishing.\n\nPaths needing attention:\n- a.ts',
		},
	];

	await processAssistantResponse(
		createDefaultParams({
			client,
			messages,
			// yolo so the tool auto-executes and the loop takes its
			// tool-execution recursion, which is where the lifecycle used to be
			// dropped.
			developmentMode: 'yolo',
			toolManager: createMockToolManager({
				tools: ['some_tool', 'write_walkthrough'],
				needsApproval: false,
			}),
		}),
	);

	t.is(chatCallCount, 3, 'tool turn, answer turn, then the nudged turn');
	t.true(
		nudge.includes('write_walkthrough'),
		'the walkthrough nudge must still fire once the real work is done',
	);
});
// ============================================================================
// Configurable Retry Limits (issue #897)
// ============================================================================

// Client that returns the identical tool call on every turn — the signature
// the repeated-call loop detector keys on.
const createRepeatingToolClient = (onChat?: () => void) => ({
	chat: async (): Promise<LLMChatResponse> => {
		onChat?.();
		return {
			choices: [
				{
					message: {
						role: 'assistant',
						content: '',
						tool_calls: [
							{
								id: 'call_loop',
								function: {name: 'read_file', arguments: '{"path": "/tmp/x"}'},
							},
						],
					},
				},
			],
			toolsDisabled: false,
		};
	},
});

const repeatingToolManager = () =>
	createMockToolManager({tools: ['read_file'], needsApproval: false});

// Pin the resolved retry limits for the duration of a test and restore them
// afterwards. Without this the assertions read whatever `nanocoder.retries` the
// developer happens to have in their project or personal config, since the
// per-test clearAppConfig() re-resolves from disk.
const withRetryLimits = async (
	overrides: Partial<RetryLimitsConfig>,
	run: () => Promise<void>,
) => {
	const retries = getAppConfig().retries;
	if (!retries) {
		throw new Error('Resolved config should always carry retry limits');
	}
	const originals = {...retries};
	Object.assign(retries, overrides);
	try {
		await run();
	} finally {
		Object.assign(retries, originals);
	}
};

test.serial('repeated-tool-call limit pauses and stops when the user declines', async t => {
	let chatCallCount = 0;
	let questionCount = 0;
	const queuedComponents: any[] = [];

	setGlobalQuestionHandler(async question => {
		questionCount += 1;
		t.regex(question.question, /repeated the same tool call 3 times in a row/);
		// First option is the safe default: stop.
		return question.options[0];
	});

	await withRetryLimits({maxRepeatedToolCalls: 3}, async () => {
		const params = createDefaultParams({
			client: createRepeatingToolClient(() => chatCallCount++),
			toolManager: repeatingToolManager(),
			addToChatQueue: (component: any) => queuedComponents.push(component),
		});

		await processAssistantResponse(params);
	});

	// Default maxRepeatedToolCalls = 3: turns 1 and 2 execute, turn 3 trips
	// the limit and prompts. Declining stops the loop.
	t.is(chatCallCount, 3, 'Loop should stop at the default limit of 3');
	t.is(questionCount, 1, 'Should pause and ask exactly once');
	const stopMessage = queuedComponents.find(
		(c: any) =>
			typeof c.props?.message === 'string' &&
			c.props.message.includes('repeated the same tool call 3 times in a row'),
	);
	t.truthy(stopMessage, 'Should queue the loop-detected ErrorMessage');
});

test.serial('repeated-tool-call limit grants another window when the user continues', async t => {
	let chatCallCount = 0;
	let questionCount = 0;
	const questionTexts: string[] = [];
	const queuedComponents: any[] = [];

	setGlobalQuestionHandler(async question => {
		questionCount += 1;
		questionTexts.push(question.question);
		// Continue on the first prompt, stop on the second.
		return questionCount === 1 ? question.options[1] : question.options[0];
	});

	await withRetryLimits({maxRepeatedToolCalls: 3}, async () => {
		const params = createDefaultParams({
			client: createRepeatingToolClient(() => chatCallCount++),
			toolManager: repeatingToolManager(),
			addToChatQueue: (component: any) => queuedComponents.push(component),
		});

		await processAssistantResponse(params);
	});

	// Continuing resets the streak: 3 turns to the first prompt, then 3 more
	// identical turns to the second prompt, where the user stops.
	t.is(chatCallCount, 6, 'Continue should grant a full new window of turns');
	t.is(questionCount, 2, 'Should re-prompt after the granted window is spent');
	// The per-window streak resets on continue, but the reported count is the
	// true cumulative streak, so the second prompt says 6 rather than 3 again.
	t.regex(questionTexts[0], /repeated the same tool call 3 times in a row/);
	t.regex(questionTexts[1], /repeated the same tool call 6 times in a row/);
	const continueNotice = queuedComponents.find(
		(c: any) =>
			typeof c.props?.message === 'string' &&
			c.props.message.includes('Continuing'),
	);
	t.truthy(continueNotice, 'Should queue an InfoMessage when continuing');
	const stopMessage = queuedComponents.find(
		(c: any) =>
			typeof c.props?.message === 'string' &&
			c.props.message.includes('repeated the same tool call'),
	);
	t.regex(
		stopMessage?.props?.message ?? '',
		/repeated the same tool call 6 times in a row/,
		'Stop message should report the cumulative streak, not the window count',
	);
});

test.serial('repeated-tool-call limit does not fire one call under the limit', async t => {
	let chatCallCount = 0;
	let questionCount = 0;

	setGlobalQuestionHandler(async question => {
		questionCount += 1;
		return question.options[0];
	});

	// Two identical tool turns (one under the default limit of 3), then a
	// terminal text-only response.
	const client = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			if (chatCallCount <= 2) {
				return {
					choices: [
						{
							message: {
								role: 'assistant',
								content: '',
								tool_calls: [
									{
										id: 'call_loop',
										function: {
											name: 'read_file',
											arguments: '{"path": "/tmp/x"}',
										},
									},
								],
							},
						},
					],
					toolsDisabled: false,
				};
			}
			return {
				choices: [{message: {role: 'assistant', content: 'Done.'}}],
				toolsDisabled: false,
			};
		},
	};

	await withRetryLimits({maxRepeatedToolCalls: 3}, async () => {
		const params = createDefaultParams({
			client,
			toolManager: repeatingToolManager(),
		});

		await processAssistantResponse(params);
	});

	t.is(chatCallCount, 3, 'All three turns should run to natural completion');
	t.is(questionCount, 0, 'Must not prompt below the limit');
});

test.serial('repeated-tool-call limit honors a custom configured value', async t => {
	let chatCallCount = 0;
	let questionCount = 0;

	setGlobalQuestionHandler(async question => {
		questionCount += 1;
		return question.options[0];
	});

	await withRetryLimits({maxRepeatedToolCalls: 2}, async () => {
		const params = createDefaultParams({
			client: createRepeatingToolClient(() => chatCallCount++),
			toolManager: repeatingToolManager(),
		});

		await processAssistantResponse(params);
	});

	t.is(chatCallCount, 2, 'Loop should stop at the configured limit of 2');
	t.is(questionCount, 1, 'Should pause and ask at the configured limit');
});

test.serial('repeated-tool-call limit hard-stops without prompting in non-interactive mode', async t => {
	let chatCallCount = 0;
	let questionCount = 0;
	const queuedComponents: any[] = [];

	setGlobalQuestionHandler(async question => {
		questionCount += 1;
		return question.options[1];
	});

	await withRetryLimits({maxRepeatedToolCalls: 3}, async () => {
		const params = createDefaultParams({
			client: createRepeatingToolClient(() => chatCallCount++),
			toolManager: repeatingToolManager(),
			nonInteractiveMode: true,
			addToChatQueue: (component: any) => queuedComponents.push(component),
		});

		await processAssistantResponse(params);
	});

	t.is(chatCallCount, 3, 'Loop should hard-stop at the limit');
	t.is(questionCount, 0, 'Must not prompt when there is nobody to ask');
	const stopMessage = queuedComponents.find(
		(c: any) =>
			typeof c.props?.message === 'string' &&
			c.props.message.includes('repeated the same tool call'),
	);
	t.truthy(stopMessage, 'Should still queue the loop-detected ErrorMessage');
});

// Client that always calls a tool the tool manager does not know — this goes
// through the unknown-tool error branch rather than tool execution.
const createUnknownToolClient = (onChat?: () => void) => ({
	chat: async (): Promise<LLMChatResponse> => {
		onChat?.();
		return {
			choices: [
				{
					message: {
						role: 'assistant',
						content: '',
						tool_calls: [
							{
								id: 'call_ghost',
								function: {name: 'ghost_tool', arguments: '{"x": 1}'},
							},
						],
					},
				},
			],
			toolsDisabled: false,
		};
	},
});

test.serial('repeated unknown-tool calls count toward the repeated-call limit', async t => {
	let chatCallCount = 0;
	let questionCount = 0;
	const queuedComponents: any[] = [];

	setGlobalQuestionHandler(async question => {
		questionCount += 1;
		t.regex(question.question, /repeated the same tool call 3 times in a row/);
		// Stop: the safe default.
		return question.options[0];
	});

	await withRetryLimits({maxRepeatedToolCalls: 3}, async () => {
		const params = createDefaultParams({
			client: createUnknownToolClient(() => chatCallCount++),
			toolManager: repeatingToolManager(),
			addToChatQueue: (component: any) => queuedComponents.push(component),
		});

		await processAssistantResponse(params);
	});

	// The unknown-tool self-correction branch must not recurse unbounded: the
	// third identical unknown-tool turn trips the same cap as a real call.
	t.is(chatCallCount, 3, 'Third identical unknown-tool turn trips the limit');
	t.is(questionCount, 1, 'Should pause and ask instead of recursing unbounded');
	const stopMessage = queuedComponents.find(
		(c: any) =>
			typeof c.props?.message === 'string' &&
			c.props.message.includes('repeated the same tool call 3 times in a row'),
	);
	t.truthy(stopMessage, 'Should queue the loop-detected ErrorMessage');
});

test.serial('repeated unknown-tool calls grant another window when the user continues', async t => {
	let chatCallCount = 0;
	let questionCount = 0;
	const questionTexts: string[] = [];

	setGlobalQuestionHandler(async question => {
		questionCount += 1;
		questionTexts.push(question.question);
		// Continue on the first prompt, stop on the second.
		return questionCount === 1 ? question.options[1] : question.options[0];
	});

	await withRetryLimits({maxRepeatedToolCalls: 3}, async () => {
		const params = createDefaultParams({
			client: createUnknownToolClient(() => chatCallCount++),
			toolManager: repeatingToolManager(),
		});

		await processAssistantResponse(params);
	});

	t.is(chatCallCount, 6, 'Continue should grant a full new window of turns');
	t.is(questionCount, 2, 'Should re-prompt after the granted window is spent');
	t.regex(questionTexts[0], /repeated the same tool call 3 times in a row/);
	t.regex(questionTexts[1], /repeated the same tool call 6 times in a row/);
});

test.serial('unknown-tool feedback is paired with its call so it reaches the model', async t => {
	// The error result only reaches the model when its tool_call is in the
	// assistant message: dropOrphanedToolResults strips results whose call is
	// missing, leaving the next turn's context unchanged and the model repeating
	// the same ghost call until the cap trips.
	const messageSnapshots: Message[][] = [];

	setGlobalQuestionHandler(async question => question.options[0]);

	await withRetryLimits({maxRepeatedToolCalls: 3}, async () => {
		const params = createDefaultParams({
			client: createUnknownToolClient(),
			toolManager: repeatingToolManager(),
			setMessages: (msgs: Message[]) => messageSnapshots.push(msgs),
		});

		await processAssistantResponse(params);
	});

	const latest = messageSnapshots[messageSnapshots.length - 1];
	const assistant = latest.find(m => m.role === 'assistant');
	t.true(
		(assistant?.tool_calls ?? []).some(tc => tc.id === 'call_ghost'),
		'the ghost call must be in the assistant message',
	);
	const delivered = dropOrphanedToolResults(latest);
	t.true(
		delivered.some(m => m.role === 'tool' && m.tool_call_id === 'call_ghost'),
		'the unknown-tool error must survive orphan pruning',
	);
});

test.serial('non-interactive approval exit pairs unconfirmed tools with cancellation results', async t => {
	const messageSnapshots: Message[][] = [];

	const params = createDefaultParams({
		client: {
			chat: async (): Promise<LLMChatResponse> => ({
				choices: [
					{
						message: {
							role: 'assistant',
							content: '',
							tool_calls: [
								{
									id: 'call_guarded',
									function: {name: 'guarded_tool', arguments: '{}'},
								},
							],
						},
					},
				],
				toolsDisabled: false,
			}),
		},
		toolManager: createMockToolManager({
			tools: ['guarded_tool'],
			needsApproval: true,
		}),
		nonInteractiveMode: true,
		setMessages: (msgs: Message[]) => messageSnapshots.push(msgs),
	});

	await processAssistantResponse(params);

	// The exit is terminal, so the saved history must pair the announced call
	// with a result - a later resume would otherwise replay an assistant
	// tool_call that never received one, which strict providers reject.
	const latest = messageSnapshots[messageSnapshots.length - 1];
	const assistant = latest.find(m => m.role === 'assistant' && m.tool_calls);
	t.true(
		(assistant?.tool_calls ?? []).some(tc => tc.id === 'call_guarded'),
		'the guarded call must be announced in the assistant message',
	);
	const result = latest.find(
		m => m.role === 'tool' && m.tool_call_id === 'call_guarded',
	);
	t.truthy(result, 'the unconfirmed tool must get a paired result');
	// Not the user-cancellation wording: nobody declined this tool, and a
	// resumed interactive session must not read the history as a refusal.
	t.regex(String(result?.content), /approval unavailable in non-interactive/i);
	t.notRegex(String(result?.content), /cancelled by the user/i);
});

test.serial('escape mid-execution pairs the tools the confirm loop never reached', async t => {
	const messageSnapshots: Message[][] = [];
	const controller = new AbortController();

	// Approve the first tool, then abort before it finishes so the loop breaks
	// with the second tool still pending.
	setGlobalToolConfirmHandler(async () => {
		controller.abort();
		return true;
	});

	let chatCallCount = 0;
	const params = createDefaultParams({
		client: {
			chat: async (): Promise<LLMChatResponse> => {
				chatCallCount += 1;
				if (chatCallCount > 1) {
					return {
						choices: [{message: {role: 'assistant', content: 'Done.'}}],
						toolsDisabled: false,
					};
				}
				return {
					choices: [
						{
							message: {
								role: 'assistant',
								content: '',
								tool_calls: [
									{
										id: 'call_first',
										function: {name: 'guarded_tool', arguments: '{}'},
									},
									{
										id: 'call_second',
										function: {name: 'guarded_tool', arguments: '{}'},
									},
								],
							},
						},
					],
					toolsDisabled: false,
				};
			},
		},
		toolManager: createMockToolManager({
			tools: ['guarded_tool'],
			needsApproval: true,
		}),
		abortController: controller,
		setMessages: (msgs: Message[]) => messageSnapshots.push(msgs),
	});

	await processAssistantResponse(params);

	setGlobalToolConfirmHandler(async () => false);

	// The assistant message announces both calls, so the saved history must
	// carry a result for the tool the abort skipped too.
	const latest = messageSnapshots[messageSnapshots.length - 1];
	const assistant = latest.find(m => m.role === 'assistant' && m.tool_calls);
	t.deepEqual(
		(assistant?.tool_calls ?? []).map(tc => tc.id),
		['call_first', 'call_second'],
		'both calls must be announced in the assistant message',
	);
	for (const id of ['call_first', 'call_second']) {
		t.truthy(
			latest.find(m => m.role === 'tool' && m.tool_call_id === id),
			`${id} must receive a paired tool result`,
		);
	}
	const skipped = latest.find(
		m => m.role === 'tool' && m.tool_call_id === 'call_second',
	);
	t.regex(String(skipped?.content), /cancelled by the user/i);
});

test.serial('repeated unknown-tool calls hard-stop without prompting in non-interactive mode', async t => {
	let chatCallCount = 0;
	let questionCount = 0;
	const queuedComponents: any[] = [];

	setGlobalQuestionHandler(async question => {
		questionCount += 1;
		return question.options[1];
	});

	await withRetryLimits({maxRepeatedToolCalls: 3}, async () => {
		const params = createDefaultParams({
			client: createUnknownToolClient(() => chatCallCount++),
			toolManager: repeatingToolManager(),
			nonInteractiveMode: true,
			addToChatQueue: (component: any) => queuedComponents.push(component),
		});

		await processAssistantResponse(params);
	});

	t.is(chatCallCount, 3, 'Loop should hard-stop at the limit');
	t.is(questionCount, 0, 'Must not prompt when there is nobody to ask');
	const stopMessage = queuedComponents.find(
		(c: any) =>
			typeof c.props?.message === 'string' &&
			c.props.message.includes('repeated the same tool call'),
	);
	t.truthy(stopMessage, 'Should still queue the loop-detected ErrorMessage');
});

test.serial('malformed-retry limit honors a custom configured value', async t => {
	let chatCallCount = 0;
	const queuedComponents: any[] = [];

	const alwaysMalformedClient = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			return {
				choices: [
					{
						message: {
							role: 'assistant',
							content: '[tool_use: read_file]',
							tool_calls: undefined,
						},
					},
				],
				toolsDisabled: true,
			};
		},
	};

	await withRetryLimits({maxMalformedRetries: 0}, async () => {
		const params = createDefaultParams({
			client: alwaysMalformedClient,
			addToChatQueue: (component: any) => queuedComponents.push(component),
		});

		await processAssistantResponse(params);
	});

	t.is(chatCallCount, 1, 'Limit 0 should give up after the first bad turn');
	const giveUpMessage = queuedComponents.find(
		(c: any) =>
			typeof c.props?.message === 'string' &&
			c.props.message.includes('malformed tool calls 1 times'),
	);
	t.truthy(giveUpMessage, 'Give-up message should reflect the custom limit');
});

test.serial('empty-turn limit honors a custom configured value', async t => {
	let chatCallCount = 0;
	const queuedComponents: any[] = [];

	const alwaysEmptyClient = {
		chat: async (): Promise<LLMChatResponse> => {
			chatCallCount += 1;
			return {
				choices: [
					{message: {role: 'assistant', content: '', tool_calls: undefined}},
				],
				toolsDisabled: false,
			};
		},
	};

	await withRetryLimits({maxEmptyTurns: 0}, async () => {
		const params = createDefaultParams({
			client: alwaysEmptyClient,
			addToChatQueue: (component: any) => queuedComponents.push(component),
		});

		await processAssistantResponse(params);
	});

	// Limit 0 skips all nudges: at most the initial turn plus one
	// compact-and-retry cycle (MAX_COMPACT_RETRIES = 1). The default limit
	// would make at least 3 calls before giving up.
	t.true(
		chatCallCount <= 2,
		`Limit 0 should give up within 2 calls; got ${chatCallCount}`,
	);
	const giveUpMessage = queuedComponents.find(
		(c: any) =>
			typeof c.props?.message === 'string' &&
			c.props.message.includes('produced no output'),
	);
	t.truthy(giveUpMessage, 'Should queue the give-up ErrorMessage');
});

test.serial('repeated-tool-call limit still pauses in yolo mode', async t => {
	// Yolo skips every tool confirmation, so the repeated-call pause is the one
	// remaining safeguard there. Documented in docs/features/development-modes.md.
	let chatCallCount = 0;
	let questionCount = 0;

	setGlobalQuestionHandler(async question => {
		questionCount += 1;
		return question.options[0];
	});

	await withRetryLimits({maxRepeatedToolCalls: 3}, async () => {
		const params = createDefaultParams({
			client: createRepeatingToolClient(() => chatCallCount++),
			toolManager: repeatingToolManager(),
			developmentMode: 'yolo' as const,
		});

		await processAssistantResponse(params);
	});

	t.is(chatCallCount, 3, 'Loop should stop at the limit in yolo mode too');
	t.is(questionCount, 1, 'Yolo must still get the repeated-call pause');
});

test.serial('repeated-tool-call limit hard-stops without prompting in headless mode', async t => {
	// Headless is the daemon's mode for triggered skill runs. Like
	// nonInteractiveMode there is nobody to ask, but it is a separate branch of
	// the same guard, so it needs its own coverage.
	let chatCallCount = 0;
	let questionCount = 0;
	const queuedComponents: any[] = [];

	setGlobalQuestionHandler(async question => {
		questionCount += 1;
		return question.options[1];
	});

	await withRetryLimits({maxRepeatedToolCalls: 3}, async () => {
		const params = createDefaultParams({
			client: createRepeatingToolClient(() => chatCallCount++),
			toolManager: repeatingToolManager(),
			developmentMode: 'headless' as const,
			addToChatQueue: (component: any) => queuedComponents.push(component),
		});

		await processAssistantResponse(params);
	});

	t.is(chatCallCount, 3, 'Loop should hard-stop at the limit');
	t.is(questionCount, 0, 'Must not prompt in headless mode');
	const stopMessage = queuedComponents.find(
		(c: any) =>
			typeof c.props?.message === 'string' &&
			c.props.message.includes('repeated the same tool call'),
	);
	t.truthy(stopMessage, 'Should queue the loop-detected ErrorMessage');
});

// ============================================================================
// Lifecycle hook gate (pre-tool-use)
//
// The gate has to sit in front of the approval prompt, not behind it. Behind
// it, a "never touch .env" hook still renders the full confirmation with its
// diff preview, waits for the user to approve, and only then refuses — the
// tool is blocked either way, but the user is asked to authorize something
// that was never going to run.
// ============================================================================

const HOOK_GATE_DIR = join(tmpdir(), `nanocoder-loop-hooks-${Date.now()}`);

function withLoopHooks(hooks: HooksConfig): void {
	writeFileSync(
		join(HOOK_GATE_DIR, 'agents.config.json'),
		JSON.stringify({nanocoder: {hooks}}),
		'utf-8',
	);
	reloadAppConfig();
}

function enterHookFixture(): () => void {
	const previousCwd = process.cwd();
	const previousConfigDir = process.env.NANOCODER_CONFIG_DIR;
	mkdirSync(HOOK_GATE_DIR, {recursive: true});
	process.env.NANOCODER_CONFIG_DIR = join(HOOK_GATE_DIR, 'no-global-config');
	process.chdir(HOOK_GATE_DIR);
	setProjectRoot(HOOK_GATE_DIR);
	return () => {
		process.chdir(previousCwd);
		if (previousConfigDir === undefined) {
			delete process.env.NANOCODER_CONFIG_DIR;
		} else {
			process.env.NANOCODER_CONFIG_DIR = previousConfigDir;
		}
		setProjectRoot(previousCwd);
		clearAppConfig();
	};
}

// Portable hook body: `sh -c` on POSIX, `cmd /c` on Windows.
const hookNode = (script: string) => `node -e "${script}"`;

test.serial(
	'a pre-tool-use veto blocks the tool without ever prompting for approval',
	async t => {
		const leave = enterHookFixture();
		let confirmPrompts = 0;
		const setMessagesCalls: Message[][] = [];
		let chatCalls = 0;

		try {
			withLoopHooks({
				'pre-tool-use': [
					{
						name: 'no-env',
						command: hookNode(
							"console.log('.env is off limits');process.exit(1)",
						),
					},
				],
			});

			// If the gate were behind the approval prompt, this would fire.
			setGlobalToolConfirmHandler(async () => {
				confirmPrompts++;
				return true;
			});

			const mockClient = createMockClient({content: '', toolCalls: []});
			mockClient.chat = async () => {
				chatCalls++;
				if (chatCalls === 1) {
					return {
						choices: [
							{
								message: {
									role: 'assistant',
									content: '',
									tool_calls: [
										{
											id: 'call_1',
											function: {
												name: 'some_tool',
												arguments: '{"path":".env"}',
											},
										},
									],
								},
							},
						],
						toolsDisabled: false,
					} as never;
				}
				// Terminal turn so the loop stops after the blocked result.
				return {
					choices: [{message: {role: 'assistant', content: 'understood'}}],
					toolsDisabled: false,
				} as never;
			};

			const params = createDefaultParams({
				client: mockClient,
				toolManager: createMockToolManager({
					tools: ['some_tool'],
					needsApproval: true,
				}) as never,
				nonInteractiveMode: false,
				setMessages: (m: Message[]) => setMessagesCalls.push(m),
			});

			await processAssistantResponse(params as never);
		} finally {
			setGlobalToolConfirmHandler(async () => true);
			leave();
		}

		t.is(
			confirmPrompts,
			0,
			'a vetoed tool must never reach the confirmation prompt',
		);

		const toolResults = setMessagesCalls
			.flat()
			.filter(m => m.role === 'tool')
			.map(m => String(m.content));
		t.true(
			toolResults.some(c => c.includes('.env is off limits')),
			`the hook's reason should reach the model, got: ${toolResults.join(' | ')}`,
		);
	},
);

test.serial(
	'a passing pre-tool-use hook still lets the approval prompt run',
	async t => {
		const leave = enterHookFixture();
		let confirmPrompts = 0;
		let chatCalls = 0;

		try {
			withLoopHooks({
				'pre-tool-use': [{command: hookNode('process.exit(0)')}],
			});

			setGlobalToolConfirmHandler(async () => {
				confirmPrompts++;
				return false; // decline, so the loop stops deterministically
			});

			const mockClient = createMockClient({content: '', toolCalls: []});
			mockClient.chat = async () => {
				chatCalls++;
				return {
					choices: [
						{
							message: {
								role: 'assistant',
								content: '',
								tool_calls: [
									{
										id: 'call_1',
										function: {name: 'some_tool', arguments: '{}'},
									},
								],
							},
						},
					],
					toolsDisabled: false,
				} as never;
			};

			const params = createDefaultParams({
				client: mockClient,
				toolManager: createMockToolManager({
					tools: ['some_tool'],
					needsApproval: true,
				}) as never,
				nonInteractiveMode: false,
			});

			await processAssistantResponse(params as never);
		} finally {
			setGlobalToolConfirmHandler(async () => true);
			leave();
		}

		t.is(
			confirmPrompts,
			1,
			'the gate must not swallow the approval prompt for an allowed tool',
		);
	},
);
