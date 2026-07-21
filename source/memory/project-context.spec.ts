import test from 'ava';
import {
	appendProjectContext,
	appendRelevantProjectContext,
	appendRelevantProjectContextWithCount,
	formatProjectContext,
} from './project-context.js';
import type {SemanticMemory} from './semantic-memory-manager.js';

const memory = (content: string): SemanticMemory => ({
	id: content,
	content,
	category: 'project',
	timestamp: '2026-07-17T00:00:00.000Z',
});

test('formatProjectContext returns empty string for no memories', t => {
	t.is(formatProjectContext([]), '');
});

test('formatProjectContext formats memories as project context', t => {
	t.is(
		formatProjectContext([
			memory('Auth uses Clerk.'),
			memory('Avoid middleware.\nUse adapters.'),
		]),
		'## Project Context\n\n- Auth uses Clerk.\n- Avoid middleware. Use adapters.',
	);
});

test('formatProjectContext respects token budget', t => {
	t.is(
		formatProjectContext(
			[
				memory('Use existing hooks.'),
				memory(
					'This second memory is intentionally long enough to exceed the tiny test budget.',
				),
			],
			{tokenBudget: 12},
		),
		'## Project Context\n\n- Use existing hooks.',
	);
});

test('formatProjectContext returns empty string when budget is too small', t => {
	t.is(formatProjectContext([memory('Use existing hooks.')], {tokenBudget: 1}), '');
});

test('formatProjectContext skips oversized memories within budget', t => {
	t.is(
		formatProjectContext(
			[
				memory(
					'This first memory is intentionally too long for the small budget.',
				),
				memory('Use adapters.'),
			],
			{tokenBudget: 10},
		),
		'## Project Context\n\n- Use adapters.',
	);
});

test('appendProjectContext returns original prompt without memories', t => {
	t.is(appendProjectContext('base prompt', []), 'base prompt');
});

test('appendProjectContext appends formatted memories', t => {
	t.is(
		appendProjectContext('base prompt', [memory('Use existing provider.')]),
		'base prompt\n\n## Project Context\n\n- Use existing provider.',
	);
});

test('appendRelevantProjectContext appends relevant memories', async t => {
	const prompt = await appendRelevantProjectContext('base prompt', 'auth', {
		findRelevantMemories: async (query, limit) => {
			t.is(query, 'auth');
			t.is(limit, 8);
			return [memory('Auth uses Clerk.')];
		},
	});

	t.is(prompt, 'base prompt\n\n## Project Context\n\n- Auth uses Clerk.');
});

test('appendRelevantProjectContextWithCount reports injected memory count', async t => {
	const result = await appendRelevantProjectContextWithCount(
		'base prompt',
		'auth',
		{
			findRelevantMemories: async () => [
				memory('Auth uses Clerk.'),
				memory('Use adapters.'),
			],
		},
	);

	t.is(result.memoryCount, 2);
	t.true(result.systemPrompt.includes('## Project Context'));
});

test('appendRelevantProjectContext passes configured memory limit', async t => {
	const prompt = await appendRelevantProjectContext(
		'base prompt',
		'auth',
		{
			findRelevantMemories: async (query, limit) => {
				t.is(query, 'auth');
				t.is(limit, 2);
				return [memory('Auth uses Clerk.')];
			},
		},
		{memoryLimit: 2},
	);

	t.true(prompt.includes('Auth uses Clerk.'));
});

test('appendRelevantProjectContext returns original prompt when lookup fails', async t => {
	const prompt = await appendRelevantProjectContext('base prompt', 'auth', {
		findRelevantMemories: async () => {
			throw new Error('memory unavailable');
		},
	});

	t.is(prompt, 'base prompt');
});
