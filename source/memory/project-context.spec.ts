import test from 'ava';
import {
	appendProjectContext,
	appendRelevantProjectContext,
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
			t.is(limit, 3);
			return [memory('Auth uses Clerk.')];
		},
	});

	t.is(prompt, 'base prompt\n\n## Project Context\n\n- Auth uses Clerk.');
});

test('appendRelevantProjectContext returns original prompt when lookup fails', async t => {
	const prompt = await appendRelevantProjectContext('base prompt', 'auth', {
		findRelevantMemories: async () => {
			throw new Error('memory unavailable');
		},
	});

	t.is(prompt, 'base prompt');
});
