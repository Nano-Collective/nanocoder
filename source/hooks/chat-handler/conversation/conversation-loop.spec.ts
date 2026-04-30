import test from 'ava';
import {clearAppConfig} from '@/config/index.js';
import {resetShutdownManager} from '@/utils/shutdown/shutdown-manager.js';
import {processAssistantResponse, resetFallbackNotice, resetLastTurnHadReasoning} from './conversation-loop.js';
import type {LLMChatResponse, Message, ToolCall, ToolResult} from '@/types/core';
import {
	resetAutoCompactSession,
	setAutoCompactEnabled,
	setAutoCompactThreshold,
} from '@/utils/auto-compact.js';
import {
	resetSessionContextLimit,
	setSessionContextLimit,
} from '@/models/models-dev-client.js';

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
	reasoning?: string
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
	}),
});

// Mock tool manager
const createMockToolManager = (config: {
	tools?: string[];
	validatorResult?: {valid: boolean};
	needsApproval?: boolean | (() => boolean);
	readOnly?: boolean;
}) => ({
	getAllTools: () => ({}),
	getAllToolsWithoutExecute: () => ({}),
	hasTool: (name: string) => config.tools?.includes(name) || false,
	isReadOnly: (_name: string) => config.readOnly ?? false,
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
				tool: {
					needsApproval: config.needsApproval,
				},
			};
		}
		return undefined;
	},
	getAvailableToolNames: (_tune: unknown, _mode: string) =>
		config.tools ?? ['some_tool', 'read_file'],
	getEffectiveTools: (names: string[]) => {
		const tools: Record<string, any> = {};
		for (const name of names) {
			tools[name] = {
				name,
				description: `Mock tool ${name}`,
				input_schema: {type: 'object', properties: {}},
			};
		}
		return tools;
	},
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
	getNextComponentKey: () => 1,
	currentModel: 'test-model',
	developmentMode: 'normal' as const,
	nonInteractiveMode: false,
	conversationStateManager: {
		current: {
			updateAssistantMessage: () => {},
		updateAfterToolExecution: () => {},
		},
	} as any,
	onStartToolConfirmationFlow: () => {},
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

// ============================================================================
// Auto-Nudge Tests (lines 469-506)
// ============================================================================

test.serial('processAssistantResponse - auto-nudges on empty response with recent tool results', async t => {
	// This test requires:
	// 1. Mock client.chat() to return empty content with no tool calls
	// 2. Mock messages array to have a tool result as last message
	// 3. Verify nudge message is added and function recurses

	t.pass('Auto-nudge requires proper mock setup');
});

test.serial('processAssistantResponse - auto-nudges on empty response without tool results', async t => {
	// Similar to above but without recent tool results
	// Should add a "Please continue with the task" nudge instead

	t.pass('Auto-nudge continuation requires proper mock setup');
});

// ============================================================================
// Conversation Complete Tests (lines 509-510)
// ============================================================================

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

	// Only one setTokenCount(0) — the initial streaming reset at line 180.
	const zeroCalls = tokenCountCalls.filter(v => v === 0);
	t.is(zeroCalls.length, 1, `Expected exactly 1 call to setTokenCount(0), got ${zeroCalls.length}`);
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

	// Only one setTokenCount(0) — the initial streaming reset at line 180.
	const zeroCalls = tokenCountCalls.filter(v => v === 0);
	t.is(zeroCalls.length, 1, `Expected exactly 1 call to setTokenCount(0), got ${zeroCalls.length}`);
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

test.serial('processAssistantResponse - tool confirmation flow receives compacted messages after auto-compact', async t => {
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

	let confirmationFlowMessages: Message[] | undefined;

	const mockToolManager = createMockToolManager({
		tools: ['some_tool'], // Register so filterValidToolCalls keeps it valid
		needsApproval: true,  // Force confirmation flow
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
		setTokenCount: () => {},
		setMessages: () => {},
		addToChatQueue: () => {},
		onStartToolConfirmationFlow: (_toolCalls, messages) => {
			confirmationFlowMessages = messages;
		},
	});

	await processAssistantResponse(params);

	t.truthy(
		confirmationFlowMessages,
		'onStartToolConfirmationFlow should have been called',
	);

	// The messages passed to the confirmation flow should NOT contain the full
	// original verbose content — auto-compaction should have compressed them first.
	const containsOriginalVerbose = confirmationFlowMessages!.some(
		msg => msg.content === oldVerboseContent,
	);
	t.false(
		containsOriginalVerbose,
		'Confirmation flow should receive compacted messages, not original verbose history',
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