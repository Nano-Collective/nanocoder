import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../../test-utils/render-with-theme.js';
import type {Message} from '../../types/core.js';
import type {TokenBreakdown, CostBreakdown} from '../../types/usage.js';
import {UsageDisplay} from './usage-display.js';

console.log(`\nusage-display.spec.tsx – ${React.version}`);

// Helper to create mock breakdown
function createMockBreakdown(): TokenBreakdown {
	return {
		system: 1000,
		userMessages: 500,
		assistantMessages: 800,
		toolResults: 300,
		toolDefinitions: 200,
		total: 2800, // Sum of all categories
	};
}

// Helper to create mock messages
function createMockMessages(): Message[] {
	return [
		{role: 'system', content: 'You are a helpful assistant.'},
		{role: 'user', content: 'Hello, how are you?'},
		{role: 'assistant', content: 'I am doing well, thank you!'},
		{role: 'user', content: 'Can you help me with a task?'},
		{role: 'assistant', content: 'Of course! What do you need?'},
	];
}

// Mock getMessageTokens function
function mockGetMessageTokens(message: Message): number {
	// Simple mock: estimate based on content length
	return Math.ceil(message.content.length / 4);
}

// ============================================================================
// Component Rendering Tests
// ============================================================================

test('UsageDisplay renders without crashing', t => {
	const {lastFrame} = renderWithTheme(
		<UsageDisplay
			provider="openai"
			model="gpt-4"
			contextLimit={8000}
			currentTokens={2800}
			breakdown={createMockBreakdown()}
			messages={createMockMessages()}
			tokenizerName="cl100k_base"
			getMessageTokens={mockGetMessageTokens}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
});

test('UsageDisplay displays context usage header', t => {
	const {lastFrame} = renderWithTheme(
		<UsageDisplay
			provider="openai"
			model="gpt-4"
			contextLimit={8000}
			currentTokens={2800}
			breakdown={createMockBreakdown()}
			messages={createMockMessages()}
			tokenizerName="cl100k_base"
			getMessageTokens={mockGetMessageTokens}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Context Usage/);
});

test('UsageDisplay displays overall usage section', t => {
	const {lastFrame} = renderWithTheme(
		<UsageDisplay
			provider="openai"
			model="gpt-4"
			contextLimit={8000}
			currentTokens={2800}
			breakdown={createMockBreakdown()}
			messages={createMockMessages()}
			tokenizerName="cl100k_base"
			getMessageTokens={mockGetMessageTokens}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Overall Usage/);
});

test('UsageDisplay displays usage percentage', t => {
	const {lastFrame} = renderWithTheme(
		<UsageDisplay
			provider="openai"
			model="gpt-4"
			contextLimit={8000}
			currentTokens={2800}
			breakdown={createMockBreakdown()}
			messages={createMockMessages()}
			tokenizerName="cl100k_base"
			getMessageTokens={mockGetMessageTokens}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	// 2800 / 8000 = 35%
	t.regex(output!, /35%/);
});

test('UsageDisplay displays token counts', t => {
	const {lastFrame} = renderWithTheme(
		<UsageDisplay
			provider="openai"
			model="gpt-4"
			contextLimit={8000}
			currentTokens={2800}
			breakdown={createMockBreakdown()}
			messages={createMockMessages()}
			tokenizerName="cl100k_base"
			getMessageTokens={mockGetMessageTokens}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /2,800/); // Current tokens (formatted)
	t.regex(output!, /8,000/); // Context limit (formatted)
});

// ============================================================================
// Breakdown Category Tests
// ============================================================================

test('UsageDisplay displays breakdown by category section', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Breakdown by Category/);
});

test('UsageDisplay displays system prompt category', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /System Prompt/);
	t.regex(output!, /1,000/); // System tokens from breakdown
});

test('UsageDisplay displays user messages category', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /User Messages/);
	t.regex(output!, /500/); // User message tokens from breakdown
});

test('UsageDisplay displays assistant messages category', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Assistant Messages/);
	t.regex(output!, /800/); // Assistant message tokens from breakdown
});

test('UsageDisplay displays tool messages category', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Tool Messages/);
	t.regex(output!, /300/); // Tool result tokens from breakdown
});

test('UsageDisplay displays tool definitions category', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Tool Definitions/);
	t.regex(output!, /200/); // Tool definition tokens from breakdown
});

// ============================================================================
// Model Information Tests
// ============================================================================

test('UsageDisplay displays model information section', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Model Information/);
});

test('UsageDisplay displays provider name', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="anthropic"
				model="claude-3-opus"
				contextLimit={200000}
				currentTokens={50000}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="claude_tokenizer"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Provider:/);
	t.regex(output!, /anthropic/);
});

test('UsageDisplay displays model name', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4-turbo"
				contextLimit={128000}
				currentTokens={10000}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Model:/);
	t.regex(output!, /gpt-4-turbo/);
});

test('UsageDisplay displays context limit', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Context Limit:/);
	t.regex(output!, /8,000/);
});

test('UsageDisplay displays tokenizer name', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Tokenizer:/);
	t.regex(output!, /cl100k_base/);
});

// ============================================================================
// Recent Activity Tests
// ============================================================================

test('UsageDisplay displays recent activity section', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Recent Activity/);
});

test('UsageDisplay displays last 5 messages count', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Last 5 messages:/);
	t.regex(output!, /tokens/); // Should show token count
});

test('UsageDisplay displays largest message size', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Largest message:/);
	t.regex(output!, /tokens/);
});

// ============================================================================
// Available Tokens Tests
// ============================================================================

test('UsageDisplay displays available tokens', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Available:/);
	t.regex(output!, /5,200/); // 8000 - 2800 = 5200
});

// ============================================================================
// Edge Cases
// ============================================================================

test('UsageDisplay handles null context limit', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={null}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Unknown/); // Should display "Unknown" for context limit
});

test('UsageDisplay handles zero current tokens', t => {
	const emptyBreakdown: TokenBreakdown = {
		system: 0,
		userMessages: 0,
		assistantMessages: 0,
		toolResults: 0,
		toolDefinitions: 0,
		total: 0,
	};

	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={0}
				breakdown={emptyBreakdown}
				messages={[]}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /0%/); // Should display 0%
});

test('UsageDisplay handles empty messages array', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={createMockBreakdown()}
				messages={[]}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should still render without crashing
});

test('UsageDisplay handles 100% usage', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={8000}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /100%/);
	t.regex(output!, /Available:.*0 tokens/); // 0 tokens available
});

test('UsageDisplay handles over 100% usage', t => {
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={9000}
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should handle gracefully, though this is an edge case
	t.regex(output!, /\d+%/); // Should display some percentage
});

test('UsageDisplay displays warning color for moderate usage', t => {
	// 75% usage - in the warning range (70-89%)
	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={10000}
				currentTokens={7500} // 75% usage - warning range
				breakdown={createMockBreakdown()}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /75%/); // Should display 75%
});

test('UsageDisplay handles very large token counts', t => {
	const largeBreakdown: TokenBreakdown = {
		system: 100000,
		userMessages: 50000,
		assistantMessages: 80000,
		toolResults: 30000,
		toolDefinitions: 20000,
		total: 280000,
	};

	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="anthropic"
				model="claude-3-opus"
				contextLimit={200000}
				currentTokens={280000}
				breakdown={largeBreakdown}
				messages={createMockMessages()}
				tokenizerName="claude_tokenizer"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should format large numbers with commas (locale-independent)
	t.regex(output!, /1(?:00,000|,00,000)/);
	t.regex(output!, /2(?:00,000|,00,000)/);
});

test('UsageDisplay handles single message', t => {
	const messages: Message[] = [{role: 'user', content: 'Only message'}];

	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={100}
				breakdown={createMockBreakdown()}
				messages={messages}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should handle single message in recent activity
	t.regex(output!, /Last 5 messages:/);
});

test('UsageDisplay handles fewer than 5 messages', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Message 1'},
		{role: 'assistant', content: 'Message 2'},
		{role: 'user', content: 'Message 3'},
	];

	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={100}
				breakdown={createMockBreakdown()}
				messages={messages}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	// Should handle fewer than 5 messages gracefully
	t.regex(output!, /Last 5 messages:/);
});

// ============================================================================
// Progress Bar Tests (Indirectly via percentages)
// ============================================================================

test('UsageDisplay calculates correct percentages for categories', t => {
	// Current tokens = 2800 from breakdown (1000+500+800+300+200)
	const breakdown: TokenBreakdown = {
		system: 1000, // 1000/2800 = ~36%
		userMessages: 500, // 500/2800 = ~18%
		assistantMessages: 800, // 800/2800 = ~29%
		toolResults: 300, // 300/2800 = ~11%
		toolDefinitions: 200, // 200/2800 = ~7%
		total: 2800,
	};

	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={2800}
				breakdown={breakdown}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);

	// Check that percentages are displayed (rounded)
	t.regex(output!, /36%.*1,000/); // System: ~36%
	t.regex(output!, /18%.*500/); // User: ~18%
	t.regex(output!, /29%.*800/); // Assistant: ~29%
	t.regex(output!, /11%.*300/); // Tool results: ~11%
	t.regex(output!, /7%.*200/); // Tool definitions: ~7%
});

	test('UsageDisplay handles zero tokens in a category', t => {
	const breakdown: TokenBreakdown = {
		system: 1000,
		userMessages: 0,
		assistantMessages: 800,
		toolResults: 0,
		toolDefinitions: 0,
		total: 1800,
	};

	const {lastFrame} = renderWithTheme(
			<UsageDisplay
				provider="openai"
				model="gpt-4"
				contextLimit={8000}
				currentTokens={1800}
				breakdown={breakdown}
				messages={createMockMessages()}
				tokenizerName="cl100k_base"
				getMessageTokens={mockGetMessageTokens}
			/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /0%.*0\)/); // Categories with 0 tokens should show 0%
});

// ============================================================================
// Cost Estimation Display Tests (PLAN.md)
// ============================================================================

test('UsageDisplay shows formatted USD for a priced cost breakdown', t => {
	const cost: CostBreakdown = {
		currentContext: 0.0027,
		cumulativeSession: 1.23,
	};

	const {lastFrame} = renderWithTheme(
		<UsageDisplay
			provider="openai"
			model="gpt-4"
			contextLimit={8000}
			currentTokens={2800}
			breakdown={createMockBreakdown()}
			messages={createMockMessages()}
			tokenizerName="cl100k_base"
			getMessageTokens={mockGetMessageTokens}
			cost={cost}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Estimated Cost/);
	t.regex(output!, /\$0\.0027/);
	t.regex(output!, /\$1\.23/);
});

test('UsageDisplay shows em dash placeholder when cost values are NaN', t => {
	const cost: CostBreakdown = {
		currentContext: NaN,
		cumulativeSession: NaN,
	};

	const {lastFrame} = renderWithTheme(
		<UsageDisplay
			provider="ollama"
			model="llama3.2:3b"
			contextLimit={8000}
			currentTokens={2800}
			breakdown={createMockBreakdown()}
			messages={createMockMessages()}
			tokenizerName="cl100k_base"
			getMessageTokens={mockGetMessageTokens}
			cost={cost}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Estimated Cost/);
	t.regex(output!, /Current Context:.*—/);
	t.regex(output!, /Cumulative Session:.*—/);
});

test('UsageDisplay shows per-provider subtotals when multiple providers', t => {
	const cost: CostBreakdown = {
		currentContext: 0.005,
		cumulativeSession: 0.012,
		perProvider: {
			openai: 0.008,
			ollama: 0.004,
		},
	};

	const {lastFrame} = renderWithTheme(
		<UsageDisplay
			provider="openai"
			model="gpt-4o"
			contextLimit={8000}
			currentTokens={2800}
			breakdown={createMockBreakdown()}
			messages={createMockMessages()}
			tokenizerName="cl100k_base"
			getMessageTokens={mockGetMessageTokens}
			cost={cost}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Estimated Cost/);
	t.regex(output!, /Per-Provider:/);
	t.regex(output!, /openai:.*\$0\.008/);
	t.regex(output!, /ollama:.*\$0\.004/);
});

test('UsageDisplay does not render cost section when cost prop is undefined', t => {
	const {lastFrame} = renderWithTheme(
		<UsageDisplay
			provider="openai"
			model="gpt-4"
			contextLimit={8000}
			currentTokens={2800}
			breakdown={createMockBreakdown()}
			messages={createMockMessages()}
			tokenizerName="cl100k_base"
			getMessageTokens={mockGetMessageTokens}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /Estimated Cost/);
});
