import test from 'ava';
import {
	appendRelevantProjectContextWithCount,
	type ProjectContextOptions,
} from './project-context.js';
import type {SemanticMemory} from './semantic-memory-manager.js';

const memory = (content: string): SemanticMemory => ({
	id: content,
	content,
	category: 'project',
	timestamp: '2026-07-17T00:00:00.000Z',
});

async function inject(
	memories: SemanticMemory[],
	options: ProjectContextOptions = {},
	query = 'auth',
) {
	return appendRelevantProjectContextWithCount(
		'base prompt',
		query,
		{findRelevantMemories: async () => memories},
		options,
	);
}

test('appendRelevantProjectContextWithCount returns original prompt for no memories', async t => {
	const result = await inject([]);
	t.is(result.systemPrompt, 'base prompt');
	t.is(result.memoryCount, 0);
});

test('appendRelevantProjectContextWithCount formats memories as project context', async t => {
	const result = await inject([
		memory('Auth uses Clerk.'),
		memory('Avoid middleware.\nUse adapters.'),
	]);
	t.is(
		result.systemPrompt,
		'base prompt\n\n## Project Context\n\n```\n- Auth uses Clerk.\n- Avoid middleware. Use adapters.\n```',
	);
	t.is(result.memoryCount, 2);
});

test('appendRelevantProjectContextWithCount strips a leading list marker so bullets are not doubled', async t => {
	const result = await inject([
		memory('- Added a regression test for the 40-column case.'),
	]);
	t.is(
		result.systemPrompt,
		'base prompt\n\n## Project Context\n\n```\n- Added a regression test for the 40-column case.\n```',
	);
});

test('appendRelevantProjectContextWithCount respects token budget', async t => {
	const result = await inject(
		[
			memory('Use existing hooks.'),
			memory(
				'This second memory is intentionally long enough to exceed the tiny test budget.',
			),
		],
		{tokenBudget: 14},
	);
	t.is(
		result.systemPrompt,
		'base prompt\n\n## Project Context\n\n```\n- Use existing hooks.\n```',
	);
});

test('appendRelevantProjectContextWithCount returns original prompt when budget is too small', async t => {
	const result = await inject([memory('Use existing hooks.')], {
		tokenBudget: 1,
	});
	t.is(result.systemPrompt, 'base prompt');
	t.is(result.memoryCount, 0);
});

test('appendRelevantProjectContextWithCount skips an oversized memory and still injects later ones', async t => {
	const result = await inject(
		[
			memory('This first memory is intentionally too long for the small budget.'),
			memory('Use adapters.'),
		],
		{tokenBudget: 12},
	);
	t.is(
		result.systemPrompt,
		'base prompt\n\n## Project Context\n\n```\n- Use adapters.\n```',
	);
	t.is(result.memoryCount, 1);
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

test('appendRelevantProjectContextWithCount skips memory lookup when disabled', async t => {
	const result = await appendRelevantProjectContextWithCount(
		'base prompt',
		'auth',
		{
			findRelevantMemories: async () => {
				throw new Error('should not look up memories when disabled');
			},
		},
		{semanticMemoryEnabled: false},
	);

	t.is(result.memoryCount, 0);
	t.is(result.systemPrompt, 'base prompt');
});

test('appendRelevantProjectContextWithCount passes configured memory limit', async t => {
	const result = await appendRelevantProjectContextWithCount(
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

	t.true(result.systemPrompt.includes('Auth uses Clerk.'));
});

test('appendRelevantProjectContextWithCount returns original prompt when lookup fails', async t => {
	const result = await appendRelevantProjectContextWithCount(
		'base prompt',
		'auth',
		{
			findRelevantMemories: async () => {
				throw new Error('memory unavailable');
			},
		},
	);

	t.is(result.systemPrompt, 'base prompt');
	t.is(result.memoryCount, 0);
});

test('appendRelevantProjectContextWithCount widens the fence so memory content cannot escape it', async t => {
	const result = await inject([
		memory('Use ``` fenced blocks ``` carefully.'),
	]);

	t.is(
		result.systemPrompt,
		'base prompt\n\n## Project Context\n\n````\n- Use ``` fenced blocks ``` carefully.\n````',
	);
	const [, body] = result.systemPrompt.split('````');
	t.true(body?.includes('fenced blocks') ?? false);
});

test('appendRelevantProjectContextWithCount keeps the standard fence when content has no backticks', async t => {
	const result = await inject([memory('Auth uses Clerk.')]);
	t.is(
		result.systemPrompt,
		'base prompt\n\n## Project Context\n\n```\n- Auth uses Clerk.\n```',
	);
});
