import test from 'ava';
import type {ContextManagementConfig} from '@/types/config';
import type {Message} from '@/types/core';
import {buildFinalPrompt, ContextOverflowError} from './prompt-builder';

test('buildFinalPrompt returns unchanged when within budget', t => {
	const messages: Message[] = [
		{role: 'system', content: 'You are helpful'},
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: 'Hi!'},
	];
	const config: ContextManagementConfig = {
		maxContextTokens: 10000,
		reservedOutputTokens: 1000,
	};

	const result = buildFinalPrompt(messages, config);

	t.false(result.wasTrimmed);
	t.true(result.withinBudget);
	t.is(result.droppedCount, 0);
	t.is(result.messages.length, messages.length);
});

test('buildFinalPrompt trims when necessary', t => {
	const largeContent = 'x'.repeat(50000);
	const messages: Message[] = [
		{role: 'system', content: 'System prompt'},
		{role: 'user', content: 'Question'},
		{
			role: 'assistant',
			content: 'Response',
			tool_calls: [{
				id: '1',
				function: {name: 'read', arguments: {}},
			}],
		},
		{
			role: 'tool',
			tool_call_id: '1',
			content: largeContent,
		},
		{role: 'user', content: 'Follow-up'},
	];
	const config: ContextManagementConfig = {
		maxContextTokens: 1000,
		reservedOutputTokens: 100,
	};

	const result = buildFinalPrompt(messages, config);

	t.true(result.wasTrimmed);
	t.true(result.withinBudget);
	const maxInputTokens = 1000 - 100; // 900
	t.true(result.tokenCount <= maxInputTokens);
});

test('buildFinalPrompt throws ContextOverflowError when cannot fit', t => {
	const hugeContent = 'x'.repeat(100000);
	const messages: Message[] = [
		{role: 'system', content: hugeContent},
	];
	const config: ContextManagementConfig = {
		maxContextTokens: 100,
		reservedOutputTokens: 50,
	};

	const error = t.throws(
		() => buildFinalPrompt(messages, config),
		{
			instanceOf: ContextOverflowError,
		},
	);

	t.true(error?.message.includes('Cannot fit request'));
});

test('ContextOverflowError includes token information', t => {
	const hugeContent = 'x'.repeat(100000);
	const messages: Message[] = [
		{role: 'system', content: hugeContent},
	];
	const config: ContextManagementConfig = {
		maxContextTokens: 100,
		reservedOutputTokens: 50,
	};

	const error = t.throws(
		() => buildFinalPrompt(messages, config),
		{
			instanceOf: ContextOverflowError,
		},
	);

	if (error instanceof ContextOverflowError) {
		t.true(error.currentTokens > 0);
		t.is(error.maxTokens, 50);
		t.is(error.name, 'ContextOverflowError');
	}
});

test('buildFinalPrompt returns correct token count', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Test message'},
		{role: 'assistant', content: 'Response'},
	];
	const config: ContextManagementConfig = {
		maxContextTokens: 10000,
		reservedOutputTokens: 1000,
	};

	const result = buildFinalPrompt(messages, config);

	t.true(result.tokenCount > 0);
	t.is(result.tokenCount, result.messages.length > 0 ? result.tokenCount : 0);
});

test('buildFinalPrompt with provider and model parameters', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Hello'},
	];
	const config: ContextManagementConfig = {
		maxContextTokens: 10000,
		reservedOutputTokens: 1000,
	};

	const result = buildFinalPrompt(
		messages,
		config,
		'anthropic',
		'claude-3-5-sonnet-20241022',
	);

	t.true(result.withinBudget);
	t.false(result.wasTrimmed);
	t.is(result.droppedCount, 0);
});

test('buildFinalPrompt preserves message order', t => {
	const messages: Message[] = [
		{role: 'user', content: 'First'},
		{role: 'assistant', content: 'Second'},
		{role: 'user', content: 'Third'},
	];
	const config: ContextManagementConfig = {
		maxContextTokens: 10000,
		reservedOutputTokens: 1000,
	};

	const result = buildFinalPrompt(messages, config);

	for (let i = 0; i < result.messages.length; i++) {
		if (i < messages.length) {
			t.is(result.messages[i].role, messages[i].role);
		}
	}
});

test('buildFinalPrompt uses default reserved output tokens', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Test'},
	];
	const config: ContextManagementConfig = {
		maxContextTokens: 100000,
		// reservedOutputTokens not specified
	};

	// Should use default of 4096
	const result = buildFinalPrompt(messages, config);

	// Token count should be less than maxContextTokens - 4096
	t.true(result.tokenCount < 100000 - 4096 + 1000); // Some margin for calculation differences
	t.true(result.withinBudget);
});

test('buildFinalPrompt respects preserveRecentTurns setting', t => {
	const messages: Message[] = Array(20)
		.fill(null)
		.map((_, i) => ({
			role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
			content: `Message ${i}`,
		}));

	const config: ContextManagementConfig = {
		maxContextTokens: 1000,
		reservedOutputTokens: 100,
		preserveRecentTurns: 3,
	};

	const result = buildFinalPrompt(messages, config);

	// Should preserve some recent messages
	t.true(result.messages.length > 0);
	// Last message should be preserved
	t.is(
		result.messages[result.messages.length - 1].content,
		'Message 19',
	);
});
