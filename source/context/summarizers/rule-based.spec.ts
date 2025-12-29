import test from 'ava';
import type {Message} from '@/types/core';
import {RuleBasedSummarizer} from './rule-based';

const defaultOptions = {
	maxSummaryTokens: 500,
	preserveErrorDetails: true,
	mode: 'rule-based' as const,
};

test('rule-based summarizer processes file reads', async t => {
	const messages: Message[] = [
		{
			role: 'tool',
			name: 'read_file',
			content: 'export function test() {}\nexport class TestClass {}',
			tool_call_id: '1',
		},
	];

	const summarizer = new RuleBasedSummarizer();
	const result = await summarizer.summarize(messages, defaultOptions);

	t.is(result.mode, 'rule-based');
	t.truthy(result.summary.includes('read_file'));
	t.true(result.tokensUsed > 0);
	t.is(result.messagesProcessed, 1);
});

test('rule-based summarizer detects errors in bash output', async t => {
	const messages: Message[] = [
		{
			role: 'tool',
			name: 'execute_bash',
			content: 'npm install\nError: Package not found\nExited with code 1',
			tool_call_id: '1',
		},
	];

	const summarizer = new RuleBasedSummarizer();
	const result = await summarizer.summarize(messages, defaultOptions);

	t.truthy(result.summary.includes('error') || result.summary.includes('ERROR'));
});

test('rule-based summarizer handles search results', async t => {
	const messages: Message[] = [
		{
			role: 'tool',
			name: 'search_files',
			content: 'file1.ts\nfile2.ts\nfile3.ts',
			tool_call_id: '1',
		},
	];

	const summarizer = new RuleBasedSummarizer();
	const result = await summarizer.summarize(messages, defaultOptions);

	t.truthy(result.summary.includes('search') || result.summary.includes('Matches'));
});

test('rule-based summarizer processes file writes', async t => {
	const messages: Message[] = [
		{
			role: 'tool',
			name: 'write_file',
			content: 'const x = 1;\nconst y = 2;\nconst z = 3;',
			tool_call_id: '1',
		},
	];

	const summarizer = new RuleBasedSummarizer();
	const result = await summarizer.summarize(messages, defaultOptions);

	t.truthy(result.summary.includes('write_file'));
});

test('rule-based summarizer handles file edits', async t => {
	const messages: Message[] = [
		{
			role: 'tool',
			name: 'string_replace',
			content: 'File edited successfully',
			tool_call_id: '1',
		},
	];

	const summarizer = new RuleBasedSummarizer();
	const result = await summarizer.summarize(messages, defaultOptions);

	t.truthy(result.summary.includes('string_replace'));
});

test('rule-based summarizer combines multiple tool results', async t => {
	const messages: Message[] = [
		{
			role: 'tool',
			name: 'read_file',
			content: 'export function test() {}',
			tool_call_id: '1',
		},
		{
			role: 'user',
			content: 'What did you find?',
		},
		{
			role: 'tool',
			name: 'execute_bash',
			content: 'npm test\nAll tests passed',
			tool_call_id: '2',
		},
	];

	const summarizer = new RuleBasedSummarizer();
	const result = await summarizer.summarize(messages, defaultOptions);

	t.is(result.messagesProcessed, 3);
	t.truthy(result.summary.includes('read_file'));
	t.truthy(result.summary.includes('execute_bash'));
});

test('rule-based summarizer returns reasonable token count', async t => {
	const messages: Message[] = [
		{
			role: 'tool',
			name: 'read_file',
			content: 'x'.repeat(1000),
			tool_call_id: '1',
		},
	];

	const summarizer = new RuleBasedSummarizer();
	const result = await summarizer.summarize(messages, defaultOptions);

	// Token count should be positive and less than 500 (our max)
	t.true(result.tokensUsed > 0);
	t.true(result.tokensUsed <= defaultOptions.maxSummaryTokens);
});

test('rule-based summarizer includes summaries in output', async t => {
	const messages: Message[] = [
		{
			role: 'tool',
			name: 'read_file',
			content: 'export function test() {}',
			tool_call_id: '1',
		},
	];

	const summarizer = new RuleBasedSummarizer();
	const result = await summarizer.summarize(messages, defaultOptions);

	// Should include bracketed summary with tool info
	t.true(result.summary.includes('['));
	t.true(result.summary.includes(']'));
});

test('rule-based summarizer handles unknown tools gracefully', async t => {
	const messages: Message[] = [
		{
			role: 'tool',
			name: 'unknown_tool',
			content: 'Some output',
			tool_call_id: '1',
		},
	];

	const summarizer = new RuleBasedSummarizer();
	const result = await summarizer.summarize(messages, defaultOptions);

	t.truthy(result.summary.length > 0);
	t.is(result.mode, 'rule-based');
});

test('rule-based summarizer preserves error details', async t => {
	const messages: Message[] = [
		{
			role: 'tool',
			name: 'execute_bash',
			content: 'Fatal error: Cannot read property of undefined',
			tool_call_id: '1',
		},
	];

	const summarizer = new RuleBasedSummarizer();
	const result = await summarizer.summarize(messages, {
		...defaultOptions,
		preserveErrorDetails: true,
	});

	t.truthy(
		result.summary.toLowerCase().includes('error') ||
			result.summary.toLowerCase().includes('fatal'),
	);
});
