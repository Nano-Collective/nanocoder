import test from 'ava';
import type {Message} from '@/types/core';
import {SummaryStore} from './summary-store';
import {RuleBasedSummarizer} from './summarizers/rule-based';

const defaultOptions = {
	maxSummaryTokens: 500,
	preserveErrorDetails: true,
	mode: 'rule-based' as const,
};

const mockMessage: Message = {
	role: 'tool',
	name: 'read_file',
	content: 'export function test() {}',
	tool_call_id: '1',
};

const mockMessage2: Message = {
	role: 'tool',
	name: 'execute_bash',
	content: 'npm test passed',
	tool_call_id: '2',
};

test('summary store initializes empty', t => {
	const store = new SummaryStore();
	t.false(store.hasSummary());
	t.is(store.getSummaryInfo(), null);
	t.is(store.getSummaryMessage(), null);
});

test('summary store accumulates summaries', async t => {
	const store = new SummaryStore();
	const summarizer = new RuleBasedSummarizer();

	await store.updateSummary([mockMessage], summarizer, defaultOptions);

	t.true(store.hasSummary());
	t.truthy(store.getSummaryInfo());
	t.is(store.getSummaryInfo()?.version, 1);
});

test('summary store tracks version numbers', async t => {
	const store = new SummaryStore();
	const summarizer = new RuleBasedSummarizer();

	await store.updateSummary([mockMessage], summarizer, defaultOptions);
	t.is(store.getSummaryInfo()?.version, 1);

	await store.updateSummary([mockMessage2], summarizer, defaultOptions);
	t.is(store.getSummaryInfo()?.version, 2);
});

test('summary store injects summary as system message', async t => {
	const store = new SummaryStore();
	const summarizer = new RuleBasedSummarizer();

	await store.updateSummary([mockMessage], summarizer, defaultOptions);

	const summaryMessage = store.getSummaryMessage();
	t.is(summaryMessage?.role, 'system');
	t.truthy(
		summaryMessage?.content.includes('Previous Conversation Summary'),
	);
});

test('summary store tracks message count', async t => {
	const store = new SummaryStore();
	const summarizer = new RuleBasedSummarizer();

	await store.updateSummary([mockMessage], summarizer, defaultOptions);
	let info = store.getSummaryInfo();
	t.is(info?.messagesIncluded, 1);

	await store.updateSummary([mockMessage2], summarizer, defaultOptions);
	info = store.getSummaryInfo();
	t.is(info?.messagesIncluded, 2);
});

test('summary store tracks token usage', async t => {
	const store = new SummaryStore();
	const summarizer = new RuleBasedSummarizer();

	await store.updateSummary([mockMessage], summarizer, defaultOptions);
	const info = store.getSummaryInfo();
	t.true(info!.tokensUsed > 0);
});

test('summary store tracks timestamps', async t => {
	const store = new SummaryStore();
	const summarizer = new RuleBasedSummarizer();

	const before = Date.now();
	await store.updateSummary([mockMessage], summarizer, defaultOptions);
	const after = Date.now();

	const info = store.getSummaryInfo();
	t.true(info!.createdAt >= before && info!.createdAt <= after);
	t.true(info!.updatedAt >= before && info!.updatedAt <= after);
});

test('summary store preserves creation time across updates', async t => {
	const store = new SummaryStore();
	const summarizer = new RuleBasedSummarizer();

	await store.updateSummary([mockMessage], summarizer, defaultOptions);
	const firstInfo = store.getSummaryInfo();
	const createdAt = firstInfo!.createdAt;

	// Wait a bit to ensure time difference
	await new Promise(resolve => setTimeout(resolve, 10));

	await store.updateSummary([mockMessage2], summarizer, defaultOptions);
	const secondInfo = store.getSummaryInfo();

	t.is(createdAt, secondInfo!.createdAt);
	t.true(secondInfo!.updatedAt > createdAt);
});

test('summary store can be cleared', async t => {
	const store = new SummaryStore();
	const summarizer = new RuleBasedSummarizer();

	await store.updateSummary([mockMessage], summarizer, defaultOptions);
	t.true(store.hasSummary());

	store.clear();
	t.false(store.hasSummary());
	t.is(store.getSummaryInfo(), null);
	t.is(store.getSummaryMessage(), null);
});

test('summary store combines multiple summaries', async t => {
	const store = new SummaryStore();
	const summarizer = new RuleBasedSummarizer();

	await store.updateSummary([mockMessage], summarizer, defaultOptions);
	const firstContent = store.getSummaryInfo()?.content;

	await store.updateSummary([mockMessage2], summarizer, defaultOptions);
	const secondContent = store.getSummaryInfo()?.content;

	// Second content should include previous content (combined)
	t.notEqual(firstContent, secondContent);
	t.true(secondContent!.includes('Update'));
});

test('summary store handles summary condensing', async t => {
	const store = new SummaryStore();
	const summarizer = new RuleBasedSummarizer();

	// Create small summary first
	await store.updateSummary([mockMessage], summarizer, {
		...defaultOptions,
		maxSummaryTokens: 50, // Very small
	});

	// Update with another, this should handle growth
	await store.updateSummary([mockMessage2], summarizer, {
		...defaultOptions,
		maxSummaryTokens: 50,
	});

	const info = store.getSummaryInfo();
	t.truthy(info?.content);
	t.is(info?.version, 2);
});

test('summary store returns copy of info', async t => {
	const store = new SummaryStore();
	const summarizer = new RuleBasedSummarizer();

	await store.updateSummary([mockMessage], summarizer, defaultOptions);

	const info1 = store.getSummaryInfo();
	const info2 = store.getSummaryInfo();

	t.deepEqual(info1, info2);
	// But should be different objects
	t.not(info1, info2);
});

test('summary store message includes content', async t => {
	const store = new SummaryStore();
	const summarizer = new RuleBasedSummarizer();

	await store.updateSummary([mockMessage], summarizer, defaultOptions);

	const message = store.getSummaryMessage();
	t.truthy(message?.content.length! > 0);
	t.truthy(message?.content.includes('read_file'));
});
