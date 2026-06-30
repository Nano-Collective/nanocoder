import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import {setToolManagerGetter} from '../message-handler.js';
import {ToolManager} from '../tools/tool-manager.js';
import type {TuneConfig} from '../types/config.js';
import type {ApiCallRecord, Message} from '../types/core.js';
import {usageCommand} from './usage.js';

console.log(`\nusage.spec.tsx – ${React.version}`);

/**
 * Note: These tests make real API calls to models.dev via getModelContextLimit().
 * The API has a cache and fallback mechanisms, so it should be reliable.
 * If CI fails due to network issues, we may need to add a proper mocking solution.
 * All tests have reasonable timeouts (default 10s) to prevent hanging.
 */

// Helper to create mock metadata
function createMockMetadata(provider = 'test-provider', model = 'test-model') {
	return {
		provider,
		model,
		tokens: 100,
		getMessageTokens: (message: Message) => {
			// Simple mock: count characters as rough token estimate
			return Math.ceil(message.content.length / 4);
		},
	};
}

// Helper to create messages
function createMessages(): Message[] {
	return [
		{role: 'user', content: 'Hello, how are you?'},
		{role: 'assistant', content: 'I am doing well, thank you!'},
		{role: 'user', content: 'Can you help me with a task?'},
	];
}

// ============================================================================
// Command Metadata Tests
// ============================================================================

test('usage command has correct name', t => {
	t.is(usageCommand.name, 'usage');
});

test('usage command has description', t => {
	t.truthy(usageCommand.description);
	t.is(typeof usageCommand.description, 'string');
	t.true(usageCommand.description.length > 0);
});

test('usage command handler is a function', t => {
	t.is(typeof usageCommand.handler, 'function');
});

// ============================================================================
// Command Handler Tests
// ============================================================================

test('usage command handler returns valid React element', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
});

test('usage command handler with empty messages', async t => {
	const messages: Message[] = [];
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
});

test('usage command handler with different providers', async t => {
	const messages = createMessages();

	// Test with different provider names
	const providers = ['openai', 'anthropic', 'ollama'];

	for (const provider of providers) {
		const metadata = createMockMetadata(provider, 'test-model');
		const result = await usageCommand.handler([], messages, metadata);

		t.truthy(result);
		t.true(React.isValidElement(result));
	}
});

test('usage command handler with different models', async t => {
	const messages = createMessages();

	// Test with a realistic model name that might be found or use fallback
	const metadata = createMockMetadata('test-provider', 'gpt-4');
	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
});

test('usage command handler with system messages', async t => {
	const messages: Message[] = [
		{role: 'system', content: 'You are a helpful assistant.'},
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: 'Hi there!'},
	];
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
});

test('usage command handler with tool messages', async t => {
	const messages: Message[] = [
		{role: 'user', content: 'List files'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_1',
					function: {name: 'search_files', arguments: {pattern: '**/*.ts'}},
				},
			],
		},
		{role: 'tool', content: 'file1.ts\nfile2.ts', tool_call_id: 'call_1'},
	];
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
});

test('usage command handler with multiple message types', async t => {
	const messages: Message[] = [
		{role: 'system', content: 'You are a helpful assistant.'},
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: 'Hi! How can I help?'},
		{role: 'user', content: 'Search for files'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_1',
					function: {name: 'search_files', arguments: {pattern: '*.ts'}},
				},
			],
		},
		{role: 'tool', content: 'Results here', tool_call_id: 'call_1'},
		{role: 'assistant', content: 'Here are the files I found.'},
	];
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
});

// ============================================================================
// Component Rendering Tests
// ============================================================================

test('usage command renders without crashing', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	t.truthy(lastFrame());
});

test('usage command displays provider name', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata('openai', 'gpt-4');

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /openai/i);
});

test('usage command displays model name', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata('anthropic', 'claude-3-opus');

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /claude-3-opus/);
});

test('usage command displays context usage header', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Context Usage/);
});

test('usage command displays overall usage section', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Overall Usage/);
});

test('usage command displays category breakdown', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Breakdown by Category/);
});

test('usage command displays system prompt category', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /System Prompt/);
});

test('usage command displays user messages category', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /User Messages/);
});

test('usage command displays assistant messages category', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Assistant Messages/);
});

test('usage command displays tool messages category', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Tool Messages/);
});

test('usage command displays tool definitions category', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Tool Definitions/);
});

test('usage command displays model information section', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Model Information/);
});

test('usage command displays recent activity section', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Recent Activity/);
});

test('usage command displays tokenizer name', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	// Should display "Tokenizer:" label
	t.regex(output!, /Tokenizer:/);
});

test('usage command displays available tokens', async t => {
	const messages = createMessages();
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Available:/);
});

// ============================================================================
// Edge Cases
// ============================================================================

test('usage command handles very long messages', async t => {
	const longContent = 'a'.repeat(10000);
	const messages: Message[] = [
		{role: 'user', content: longContent},
		{role: 'assistant', content: 'Short response'},
	];
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
});

test('usage command handles messages with special characters', async t => {
	const messages: Message[] = [
		{role: 'user', content: 'Hello 你好 مرحبا'},
		{role: 'assistant', content: 'Response with émojis 🚀 and symbols ®™©'},
	];
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
});

test('usage command handles empty message content', async t => {
	const messages: Message[] = [
		{role: 'user', content: ''},
		{role: 'assistant', content: ''},
	];
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
});

test('usage command handles single message', async t => {
	const messages: Message[] = [{role: 'user', content: 'Only message'}];
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
});

test('usage command handles many messages', async t => {
	// Create 100 messages
	const messages: Message[] = [];
	for (let i = 0; i < 100; i++) {
		messages.push({
			role: i % 2 === 0 ? 'user' : 'assistant',
			content: `Message ${i}`,
		});
	}
	const metadata = createMockMetadata();

	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
});

// ============================================================================
// Custom Token Counter Tests
// ============================================================================

test('usage command uses custom getMessageTokens function', async t => {
	const messages = createMessages();
	let callCount = 0;

	const metadata = {
		provider: 'test-provider',
		model: 'test-model',
		tokens: 100,
		getMessageTokens: (_message: Message) => {
			callCount++;
			return 10; // Fixed token count for testing
		},
	};

	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
	// Should have been called for each non-system message
	t.true(callCount > 0);
});

test('usage command with custom token counter returning zero', async t => {
	const messages = createMessages();

	const metadata = {
		provider: 'test-provider',
		model: 'test-model',
		tokens: 0,
		getMessageTokens: () => 0,
	};

	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
});

test('usage command with custom token counter returning large values', async t => {
	const messages = createMessages();

	const metadata = {
		provider: 'test-provider',
		model: 'test-model',
		tokens: 1000000,
		getMessageTokens: () => 100000,
	};

	const result = await usageCommand.handler([], messages, metadata);

	t.truthy(result);
	t.true(React.isValidElement(result));
});

// ============================================================================
// Tune profile sensitivity (regression: /usage must reflect the active profile)
// ============================================================================

const tuneMeta = (toolProfile: TuneConfig['toolProfile']) => ({
	provider: 'test-provider',
	model: 'gpt-4o', // no size hint → 'auto' resolves to full; lets us vary explicitly
	tokens: 0,
	getMessageTokens: (m: Message) => Math.ceil((m.content || '').length / 4),
	tune: {enabled: true, toolProfile, aggressiveCompact: false} as TuneConfig,
	developmentMode: 'normal' as const,
});

test.serial(
	'usage reflects the tune profile in tool definitions and system prompt',
	async t => {
		setToolManagerGetter(() => new ToolManager());
		try {
			const messages = createMessages();

			const full = (await usageCommand.handler(
				[],
				messages,
				tuneMeta('full'),
			)) as React.ReactElement;
			const nano = (await usageCommand.handler(
				[],
				messages,
				tuneMeta('nano'),
			)) as React.ReactElement;

			const fullBreakdown = full.props.breakdown;
			const nanoBreakdown = nano.props.breakdown;

			// nano exposes 5 tools vs full's entire registry → fewer definition tokens
			t.true(
				nanoBreakdown.toolDefinitions < fullBreakdown.toolDefinitions,
				`nano (${nanoBreakdown.toolDefinitions}) should be < full (${fullBreakdown.toolDefinitions})`,
			);
			t.true(nanoBreakdown.toolDefinitions > 0);

			// nano drops whole prompt sections (git/web/task/diagnostics) and uses
			// the ultra-slim variants → a smaller system prompt
			t.true(
				nanoBreakdown.system < fullBreakdown.system,
				`nano system (${nanoBreakdown.system}) should be < full system (${fullBreakdown.system})`,
			);
		} finally {
			setToolManagerGetter(() => null);
		}
	},
);

// ============================================================================
// Cost Estimation Tests
// ============================================================================

test('usage command shows Estimated Cost for a priced model', async t => {
	const messages = createMessages();
	const metadata = {...createMockMetadata('openai', 'gpt-4o')};

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Estimated Cost/);
	t.regex(output!, /\$/);
});

test('usage command shows placeholder for a model without pricing', async t => {
	const messages = createMessages();
	const metadata = {...createMockMetadata('ollama', 'llama3.2:3b')};

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Estimated Cost/);
	t.regex(output!, /Current Context:.*—/);
	t.regex(output!, /Cumulative Session:.*—/);
});

test('usage command shows per-provider breakdown for multi-provider history', async t => {
	const messages = createMessages();
	const metadata = {
		...createMockMetadata('openai', 'gpt-4o'),
		apiCallHistory: [
			{
				provider: 'openai',
				model: 'gpt-4o',
				inputTokens: 500,
				outputTokens: 200,
				timestamp: Date.now(),
			},
			{
				provider: 'ollama',
				model: 'llama3.2:3b',
				inputTokens: 1000,
				outputTokens: 500,
				timestamp: Date.now(),
			},
		] satisfies ApiCallRecord[],
	};

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Per-Provider:/);
	t.regex(output!, /openai:.*\$/);
	t.regex(output!, /ollama:.*—/);
});

test('usage command hides per-provider for single-provider history', async t => {
	const messages = createMessages();
	const metadata = {
		...createMockMetadata('openai', 'gpt-4o'),
		apiCallHistory: [
			{
				provider: 'openai',
				model: 'gpt-4o',
				inputTokens: 500,
				outputTokens: 200,
				timestamp: Date.now(),
			},
			{
				provider: 'openai',
				model: 'gpt-4o',
				inputTokens: 300,
				outputTokens: 100,
				timestamp: Date.now(),
			},
		] satisfies ApiCallRecord[],
	};

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /Per-Provider:/);
});

test('usage command keeps token display unchanged when pricing is missing', async t => {
	const messages = createMessages();
	const metadata = {...createMockMetadata('openai', 'unknown-model-12345')};

	const result = await usageCommand.handler([], messages, metadata);
	const {lastFrame} = renderWithTheme(result);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Estimated Cost/);
	t.regex(output!, /—/);
	t.regex(output!, /Context Usage/);
	t.regex(output!, /Overall Usage/);
	t.regex(output!, /Breakdown by Category/);
	t.regex(output!, /Model Information/);
	t.regex(output!, /Recent Activity/);
});
