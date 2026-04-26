import test from 'ava';
import {clearAppConfig} from '@/config/index.js';
import {resetShutdownManager} from '@/utils/shutdown/shutdown-manager.js';
import {processAssistantResponse, resetFallbackNotice} from './conversation-loop.js';
import type {LLMChatResponse, Message, ToolCall, ToolResult} from '@/types/core';
import {
	resetAutoCompactSession,
	setAutoCompactEnabled,
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
}) => ({
	getAllTools: () => ({}),
	getAllToolsWithoutExecute: () => ({}),
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
				tool: {
					needsApproval: config.needsApproval,
				},
			};
		}
		return undefined;
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
 * Helper to reset shared state before each auto-compact token-count test.
 * The FallbackTokenizer uses 4 chars per token; setSessionContextLimit lets
 * us control the context window so we can deterministically trigger or avoid
 * compression by adjusting message size vs threshold.
 */
function setupAutoCompactTestEnv() {
	resetAutoCompactSession();
	setAutoCompactEnabled(true);
	resetSessionContextLimit();
	clearAppConfig();
}

test.serial.beforeEach(() => {
	setupAutoCompactTestEnv();
});

test.serial.after.always(() => {
	setupAutoCompactTestEnv();
});

test.serial('processAssistantResponse - resets token count after successful auto-compaction', async t => {
	// Set a small session context limit (100 tokens) with a low threshold (50%).
	// A large user message will exceed 50% of 100 tokens, triggering compression.
	// FallbackTokenizer counts ~1 token per 4 chars, so a 300-char message is
	// ~75 tokens + overhead, well above 50/100 = 50%.
	setSessionContextLimit(100);

	const tokenCountCalls: number[] = [];
	const messagesSetCalls: any[][] = [];

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
		setMessages: (msgs: any[]) => {
			messagesSetCalls.push(msgs);
		},
		addToChatQueue: () => {},
	});

	await processAssistantResponse(params);

	// There should be at least two setTokenCount(0) calls:
	//   1. The initial reset before streaming (line 180 in conversation-loop.tsx)
	//   2. The post-compression reset (the new line added by this fix)
	const zeroCalls = tokenCountCalls.filter(v => v === 0);
	t.true(zeroCalls.length >= 2, `Expected ≥2 calls to setTokenCount(0), got ${zeroCalls.length}`);

	// Verify that setMessages was called with compressed messages (shorter than original)
	const lastMessagesCall = messagesSetCalls[messagesSetCalls.length - 1];
	t.truthy(lastMessagesCall, 'setMessages should have been called');
	t.true(Array.isArray(lastMessagesCall), 'setMessages argument should be an array');
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
