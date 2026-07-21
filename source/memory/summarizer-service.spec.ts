import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'ava';
import {SemanticMemoryManager} from './semantic-memory-manager.js';
import {
	inferMemoryCategory,
	type MemoryProposal,
	SummarizerService,
	toCamelCaseCategory,
} from './summarizer-service.js';

async function createTempDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'nanocoder-memory-'));
}

test('SummarizerService stores a manual memory', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});
	const service = new SummarizerService(manager);

	const memory = await service.remember({
		content: '  Use the existing provider abstraction for model changes.  ',
		sourceSessionId: 'session-1',
	});

	t.is(memory.content, 'Use the existing provider abstraction for model changes.');
	t.is(memory.category, 'architecture');
	t.is(memory.sourceSessionId, 'session-1');
	t.deepEqual(await manager.listMemories(), [memory]);
});

test('SummarizerService rejects empty manual memory content', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const service = new SummarizerService(
		new SemanticMemoryManager({memoryDir: dir, cwd}),
	);

	await t.throwsAsync(service.remember({content: '   '}), {
		message: 'Memory content cannot be empty',
	});
});

test('SummarizerService uses explicit camelCase category', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const service = new SummarizerService(
		new SemanticMemoryManager({memoryDir: dir, cwd}),
	);

	const memory = await service.remember({
		content: 'Keep generated files out of review unless needed.',
		category: 'coding style',
	});

	t.is(memory.category, 'codingStyle');
});

test('inferMemoryCategory maps durable facts to stable categories', t => {
	t.is(
		inferMemoryCategory('Avoid middleware in the auth architecture.'),
		'architecture',
	);
	t.is(
		inferMemoryCategory('Use camel case for new command variables.'),
		'codingStyle',
	);
	t.is(inferMemoryCategory('This fixes the queued input regression.'), 'bugFix');
	t.is(inferMemoryCategory('Refactor the old storage path later.'), 'refactor');
	t.is(inferMemoryCategory('TODO delete obsolete project memory.'), 'todo');
	t.is(inferMemoryCategory('The project name is Nanocoder.'), 'project');
});

test('toCamelCaseCategory normalizes category names', t => {
	t.is(toCamelCaseCategory('coding style'), 'codingStyle');
	t.is(toCamelCaseCategory('BUG-FIX'), 'bugFix');
	t.is(toCamelCaseCategory(''), 'project');
});

test('SummarizerService proposes durable memories from messages', t => {
	const service = new SummarizerService();

	t.deepEqual(
		service.proposeMemoriesFromMessages([
			{
				role: 'system',
				content: 'You are Nanocoder.',
			},
			{
				role: 'user',
				content: 'Use the existing provider abstraction for model changes.',
			},
			{
				role: 'assistant',
				content: 'Fixed the queued input regression by restoring drafts.',
			},
			{
				role: 'tool',
				content: 'command output',
				tool_call_id: 'tool-1',
				name: 'execute_bash',
			},
		]),
		[
			{
				content: 'Use the existing provider abstraction for model changes.',
				category: 'architecture',
			},
			{
				content: 'Fixed the queued input regression by restoring drafts.',
				category: 'bugFix',
			},
		] satisfies MemoryProposal[],
	);
});

test('SummarizerService dedupes proposed memories', t => {
	const service = new SummarizerService();

	t.deepEqual(
		service.proposeMemoriesFromMessages([
			{
				role: 'user',
				content: 'Refactor the storage path later.',
			},
			{
				role: 'assistant',
				content: 'Refactor the storage path later.',
			},
		]),
		[
			{
				content: 'Refactor the storage path later.',
				category: 'refactor',
			},
		],
	);
});

test('SummarizerService proposals do not save memories automatically', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});
	const service = new SummarizerService(manager);

	const proposals = service.proposeMemoriesFromMessages([
		{
			role: 'user',
			content: 'TODO delete obsolete project memory later.',
		},
	]);

	t.deepEqual(proposals, [
		{
			content: 'TODO delete obsolete project memory later.',
			category: 'todo',
		},
	]);
	t.deepEqual(await manager.listMemories(), []);
});
