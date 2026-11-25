import test from 'ava';
import {
	buildProjectContextSection,
	type ProjectContextSection,
	type ProjectContextOptions,
} from './project-context.js';
import type {
	MemoryFileChange,
	SemanticMemory,
} from './semantic-memory-manager.js';

const memory = (content: string): SemanticMemory => ({
	id: content,
	content,
	category: 'project',
	timestamp: '2026-07-17T00:00:00.000Z',
});

const COMMIT = '8c21a3f9d0e4b5c6a7f8e9d0c1b2a3f4e5d6c7b8';

const trackedMemory = (content: string, files: string[]): SemanticMemory => ({
	...memory(content),
	git: {
		commit: COMMIT,
		branch: 'main',
		files: Object.fromEntries(files.map(file => [file, 'saved-hash'])),
	},
});

/**
 * The section is carried in the turn's user message now, not concatenated onto
 * the system prompt (#1574). These helpers keep the old prompt-shaped result so
 * the formatting, budget, fence and staleness assertions below still read as
 * "what the model ends up seeing".
 */
async function asPrompt(
	section: Promise<ProjectContextSection>,
): Promise<{systemPrompt: string; memoryCount: number}> {
	const {content, memoryCount} = await section;
	return {
		systemPrompt: content ? `base prompt\n\n${content}` : 'base prompt',
		memoryCount,
	};
}

/** Old prompt-shaped signature, for the tests that pass a finder inline. */
async function injectIntoPrompt(
	_systemPrompt: 'base prompt',
	query: string,
	memoryFinder: Parameters<typeof buildProjectContextSection>[1],
	options: ProjectContextOptions = {},
) {
	return asPrompt(buildProjectContextSection(query, memoryFinder, options));
}

async function injectWithChanges(
	memories: SemanticMemory[],
	changes: Record<string, MemoryFileChange[]>,
	options: ProjectContextOptions = {},
) {
	return asPrompt(
		buildProjectContextSection(
			'auth',
			{
				findRelevantMemories: async () => memories,
				findChangedFiles: async () => new Map(Object.entries(changes)),
			},
			options,
		),
	);
}

async function inject(
	memories: SemanticMemory[],
	options: ProjectContextOptions = {},
	query = 'auth',
) {
	return asPrompt(
		buildProjectContextSection(
			query,
			{findRelevantMemories: async () => memories},
			options,
		),
	);
}

test('buildProjectContextSection returns original prompt for no memories', async t => {
	const result = await inject([]);
	t.is(result.systemPrompt, 'base prompt');
	t.is(result.memoryCount, 0);
});

test('buildProjectContextSection formats memories as project context', async t => {
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

test('buildProjectContextSection strips a leading list marker so bullets are not doubled', async t => {
	const result = await inject([
		memory('- Added a regression test for the 40-column case.'),
	]);
	t.is(
		result.systemPrompt,
		'base prompt\n\n## Project Context\n\n```\n- Added a regression test for the 40-column case.\n```',
	);
});

test('buildProjectContextSection respects token budget', async t => {
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

test('buildProjectContextSection returns original prompt when budget is too small', async t => {
	const result = await inject([memory('Use existing hooks.')], {
		tokenBudget: 1,
	});
	t.is(result.systemPrompt, 'base prompt');
	t.is(result.memoryCount, 0);
});

test('buildProjectContextSection skips an oversized memory and still injects later ones', async t => {
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

test('buildProjectContextSection reports injected memory count', async t => {
	const result = await injectIntoPrompt(
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

test('buildProjectContextSection skips memory lookup when disabled', async t => {
	const result = await injectIntoPrompt(
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

test('buildProjectContextSection passes configured memory limit', async t => {
	const result = await injectIntoPrompt(
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

test('buildProjectContextSection returns original prompt when lookup fails', async t => {
	const result = await injectIntoPrompt(
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

test('buildProjectContextSection widens the fence so memory content cannot escape it', async t => {
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

test('buildProjectContextSection keeps the standard fence when content has no backticks', async t => {
	const result = await inject([memory('Auth uses Clerk.')]);
	t.is(
		result.systemPrompt,
		'base prompt\n\n## Project Context\n\n```\n- Auth uses Clerk.\n```',
	);
});

test('buildProjectContextSection warns on a memory whose file changed since it was recorded', async t => {
	const stale = trackedMemory('auth.ts refreshes tokens.', ['src/auth.ts']);
	const fresh = trackedMemory('db.ts owns the pool.', ['src/db.ts']);

	const result = await injectWithChanges([stale, fresh], {
		[stale.id]: [{path: 'src/auth.ts', status: 'modified'}],
	});

	t.is(
		result.systemPrompt,
		'base prompt\n\n## Project Context\n\n```\n- [WARNING: recorded at 8c21a3f, src/auth.ts has changed since. Verify before trusting.] auth.ts refreshes tokens.\n- db.ts owns the pool.\n```',
	);
	t.is(result.memoryCount, 2);
});

test('buildProjectContextSection names deleted files and caps the listed ones', async t => {
	const stale = trackedMemory('The data layer spans several modules.', [
		'a.ts',
		'b.ts',
		'c.ts',
		'd.ts',
		'old.ts',
	]);

	const result = await injectWithChanges([stale], {
		[stale.id]: [
			{path: 'a.ts', status: 'modified'},
			{path: 'b.ts', status: 'modified'},
			{path: 'c.ts', status: 'modified'},
			{path: 'd.ts', status: 'modified'},
			{path: 'old.ts', status: 'deleted'},
		],
	});

	t.is(
		result.systemPrompt,
		'base prompt\n\n## Project Context\n\n```\n- [WARNING: recorded at 8c21a3f, a.ts, b.ts, c.ts and 1 more have changed and old.ts has been deleted since. Verify before trusting.] The data layer spans several modules.\n```',
	);
});

test('buildProjectContextSection counts the warning against the token budget', async t => {
	const stale = trackedMemory('Use adapters.', ['src/auth.ts']);

	const result = await injectWithChanges(
		[stale],
		{[stale.id]: [{path: 'src/auth.ts', status: 'modified'}]},
		{tokenBudget: 14},
	);

	t.is(result.systemPrompt, 'base prompt');
	t.is(result.memoryCount, 0);
});

test('buildProjectContextSection still injects memories when the freshness check fails', async t => {
	const result = await injectIntoPrompt(
		'base prompt',
		'auth',
		{
			findRelevantMemories: async () => [
				trackedMemory('Auth uses Clerk.', ['src/auth.ts']),
			],
			findChangedFiles: async () => {
				throw new Error('git unavailable');
			},
		},
	);

	t.is(
		result.systemPrompt,
		'base prompt\n\n## Project Context\n\n```\n- Auth uses Clerk.\n```',
	);
	t.is(result.memoryCount, 1);
});

test('buildProjectContextSection skips the freshness check when nothing was recalled', async t => {
	const result = await injectIntoPrompt(
		'base prompt',
		'auth',
		{
			findRelevantMemories: async () => [],
			findChangedFiles: async () => {
				throw new Error('should not check freshness without memories');
			},
		},
	);

	t.is(result.systemPrompt, 'base prompt');
});
