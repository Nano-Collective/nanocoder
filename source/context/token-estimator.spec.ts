import test from 'ava';
import type {Message} from '@/types/core';
import {estimateMessageTokens, estimateTokens, getTokenizer} from './token-estimator';

test('getTokenizer returns a tokenizer', t => {
	const tokenizer = getTokenizer();
	t.truthy(tokenizer);
	t.truthy(tokenizer.encode);
	t.truthy(tokenizer.countTokens);
	t.truthy(tokenizer.getName);
});

test('getTokenizer with Claude model returns appropriate tokenizer', t => {
	const tokenizer = getTokenizer('anthropic', 'claude-3-5-sonnet-20241022');
	t.truthy(tokenizer);
	const name = tokenizer.getName();
	t.true(name === 'anthropic' || name.includes('claude'));
});

test('getTokenizer with GPT model returns appropriate tokenizer', t => {
	const tokenizer = getTokenizer('openai', 'gpt-4');
	t.truthy(tokenizer);
});

test('estimateMessageTokens includes role overhead', t => {
	const message: Message = {role: 'user', content: 'Hello'};
	const tokenizer = getTokenizer();
	const tokens = estimateMessageTokens(message, tokenizer);
	// Should be > 0 and include role overhead
	t.true(tokens > 0);
});

test('estimateMessageTokens includes content tokens', t => {
	const message1: Message = {role: 'user', content: 'Hi'};
	const message2: Message = {role: 'user', content: 'This is a much longer message with more words'};
	const tokenizer = getTokenizer();

	const tokens1 = estimateMessageTokens(message1, tokenizer);
	const tokens2 = estimateMessageTokens(message2, tokenizer);

	// Longer message should have more tokens
	t.true(tokens2 > tokens1);
});

test('estimateMessageTokens includes tool call tokens', t => {
	const messageWithoutTools: Message = {role: 'assistant', content: 'I will read a file'};
	const messageWithTools: Message = {
		role: 'assistant',
		content: 'I will read a file',
		tool_calls: [
			{
				id: '1',
				function: {
					name: 'read_file',
					arguments: {path: '/path/to/file.txt'},
				},
			},
		],
	};
	const tokenizer = getTokenizer();

	const tokens1 = estimateMessageTokens(messageWithoutTools, tokenizer);
	const tokens2 = estimateMessageTokens(messageWithTools, tokenizer);

	// Message with tool calls should have more tokens
	t.true(tokens2 > tokens1);
});

test('estimateMessageTokens includes tool call ID and name for tool results', t => {
	const message: Message = {
		role: 'tool',
		content: 'File contents here',
		tool_call_id: 'call-123',
		name: 'read_file',
	};
	const tokenizer = getTokenizer();

	const tokens = estimateMessageTokens(message, tokenizer);
	t.true(tokens > 0);
});

test('estimateTokens returns sum of all message tokens plus overhead', t => {
	const messages: Message[] = [
		{role: 'system', content: 'You are helpful.'},
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: 'Hi there!'},
	];

	const totalTokens = estimateTokens(messages);

	// Should be greater than sum of individual message lengths / 4
	const roughEstimate = messages.reduce(
		(sum, m) => sum + m.content.length / 4,
		0,
	);
	t.true(totalTokens > 0);
	t.true(totalTokens > roughEstimate * 0.5); // At least half of rough estimate
});

test('estimateTokens with specific provider and model', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Hello world'},
	];

	const tokens = estimateTokens(messages, 'anthropic', 'claude-3-5-sonnet-20241022');
	t.true(tokens > 0);
});

test('estimateTokens is consistent across multiple calls', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Test message'},
		{role: 'assistant', content: 'Response'},
	];

	const tokens1 = estimateTokens(messages);
	const tokens2 = estimateTokens(messages);

	t.is(tokens1, tokens2);
});
