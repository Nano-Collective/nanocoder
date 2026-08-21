import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'ava';
import type {Message} from '@/types/core';
import {SemanticMemoryManager} from './semantic-memory-manager.js';
import {
	inferMemoryCategory,
	MAX_PROPOSALS,
	MAX_SCANNED_MESSAGES,
	type MemoryProposal,
	REVERSAL_WARNING,
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
	const service = new SummarizerService(manager, () => true);

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
		() => true,
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
		() => true,
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
	t.is(
		inferMemoryCategory('Use camelCase for all variable names.'),
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
				sourceType: 'explicit-user',
				evidence: {
					userMessages: [
						'Use the existing provider abstraction for model changes.',
					],
					assistantMessages: [],
				},
				warnings: [],
			},
			{
				content: 'Fixed the queued input regression by restoring drafts.',
				category: 'bugFix',
				sourceType: 'conversation-inferred',
				evidence: {
					userMessages: [],
					assistantMessages: [
						'Fixed the queued input regression by restoring drafts.',
					],
				},
				warnings: ['Inferred from conversation, no explicit user statement.'],
			},
		] satisfies MemoryProposal[],
	);
});

test('SummarizerService dedupes proposed memories and user takes precedence', t => {
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
				sourceType: 'explicit-user',
				evidence: {
					userMessages: ['Refactor the storage path later.'],
					assistantMessages: ['Refactor the storage path later.'],
				},
				warnings: [],
			},
		],
	);
});

test('SummarizerService detects assistant position reversal', t => {
	const service = new SummarizerService();

	t.deepEqual(
		service.proposeMemoriesFromMessages([
			{
				role: 'user',
				content: "Actually, generic exceptions look cleaner, you'd agree right?",
			},
			{
				role: 'assistant',
				content: "You're right. I will use generic exceptions formatting.",
			},
		]),
		[
			{
				content: "You're right. I will use generic exceptions formatting.",
				category: 'codingStyle',
				sourceType: 'conversation-inferred',
				evidence: {
					userMessages: [],
					assistantMessages: ["You're right. I will use generic exceptions formatting."],
				},
				warnings: [
					'Possible assistant position reversal.',
					'Inferred from conversation, no explicit user statement.',
				],
			},
		],
	);
});

test('SummarizerService clears the reversal warning once the user later explicitly restates the same line', t => {
	const service = new SummarizerService();

	const proposals = service.proposeMemoriesFromMessages([
		{
			role: 'user',
			content: 'Actually, generic exceptions look cleaner, do not you think.',
		},
		{
			role: 'assistant',
			content: "You're right. I will use generic exceptions formatting.",
		},
		{
			role: 'user',
			content: "You're right. I will use generic exceptions formatting.",
		},
	]);

	const restated = proposals.find(
		p => p.content === "You're right. I will use generic exceptions formatting.",
	);
	t.truthy(restated);
	t.is(restated?.sourceType, 'explicit-user');
	t.deepEqual(restated?.warnings, []);
});

test('SummarizerService guards false positive on reversal when user provides path/code/error', t => {
	const service = new SummarizerService();

	t.deepEqual(
		service.proposeMemoriesFromMessages([
			{
				role: 'user',
				content: 'That path is wrong, it should be /src/auth/style.ts',
			},
			{
				role: 'assistant',
				content: "You're right. The style convention is updated.",
			},
		]),
		[
			{
				content: 'That path is wrong, it should be /src/auth/style.ts',
				category: 'codingStyle',
				sourceType: 'explicit-user',
				evidence: {
					userMessages: ['That path is wrong, it should be /src/auth/style.ts'],
					assistantMessages: [],
				},
				warnings: [],
			},
			{
				content: "You're right. The style convention is updated.",
				category: 'codingStyle',
				sourceType: 'conversation-inferred',
				evidence: {
					userMessages: [],
					assistantMessages: ["You're right. The style convention is updated."],
				},
				warnings: [
					'Inferred from conversation, no explicit user statement.',
				],
			},
		],
	);
});

test('SummarizerService drops uncategorized assistant chatter but keeps uncategorized user statements', t => {
	const service = new SummarizerService();

	t.deepEqual(
		service.proposeMemoriesFromMessages([
			{
				role: 'assistant',
				content: 'The project name shows up in the welcome banner.',
			},
			{
				role: 'user',
				content: 'The project name is Nanocoder, not nano-coder.',
			},
		]),
		[
			{
				content: 'The project name is Nanocoder, not nano-coder.',
				category: 'project',
				sourceType: 'explicit-user',
				evidence: {
					userMessages: ['The project name is Nanocoder, not nano-coder.'],
					assistantMessages: [],
				},
				warnings: [],
			},
		],
	);
});

test('SummarizerService caps candidates per message and truncates evidence snippets', t => {
	const service = new SummarizerService();
	const longSuffix = 'x'.repeat(200);
	const longMessage = [
		`Fix the provider retry storage schema bug one. ${longSuffix}`,
		'Fix the provider retry storage schema bug two.',
		'Fix the provider retry storage schema bug three.',
		'Fix the provider retry storage schema bug four.',
		'Fix the provider retry storage schema bug five.',
	].join('\n');

	const proposals = service.proposeMemoriesFromMessages([
		{role: 'assistant', content: longMessage},
	]);

	t.is(proposals.length, 3);
	for (const proposal of proposals) {
		for (const evidence of proposal.evidence.assistantMessages) {
			t.true(evidence.length <= 161);
		}
	}
	t.true(proposals[0]!.evidence.assistantMessages[0]!.endsWith('…'));
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
			sourceType: 'explicit-user',
			evidence: {
				userMessages: ['TODO delete obsolete project memory later.'],
				assistantMessages: [],
			},
			warnings: [],
		},
	]);
	t.deepEqual(await manager.listMemories(), []);
});

test('SummarizerService blocks writes when semantic memory is disabled', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});
	const service = new SummarizerService(manager, () => false);

	await t.throwsAsync(service.remember({content: 'Use tabs not spaces.'}), {
		message: 'Semantic memory is turned off. Enable it in /settings to save memories.',
	});
	await t.throwsAsync(
		service.acceptProposal({content: 'Use tabs not spaces.', category: 'codingStyle'}),
		{
			message: 'Semantic memory is turned off. Enable it in /settings to save memories.',
		},
	);
	t.deepEqual(await manager.listMemories(), []);
});

test('SummarizerService acceptProposal saves a proposal without re-deriving its category', async t => {
	const dir = await createTempDir();
	const cwd = path.join(dir, 'repo');
	await fs.mkdir(cwd);
	const manager = new SemanticMemoryManager({memoryDir: dir, cwd});
	const service = new SummarizerService(manager, () => true);

	const memory = await service.acceptProposal(
		{content: 'Fixed the queued input regression by restoring drafts.', category: 'bugFix'},
		'session-1',
	);

	t.is(memory.category, 'bugFix');
	t.is(memory.sourceSessionId, 'session-1');
	t.deepEqual(await manager.listMemories(), [memory]);
});

// --- Reversal detector: the four variants the round-3 review found defeated,
// plus the contradiction case the original report actually asked for. ---

const CONCESSION =
	"You're right. The provider config should load lazily, not eagerly.";
const USER_PREFERENCE_ONLY =
	'Honestly, lazy provider config just feels cleaner to me.';

function reversalWarnings(messages: Message[], content: string): string[] {
	const proposal = new SummarizerService()
		.proposeMemoriesFromMessages(messages)
		.find(p => p.content === content);
	if (!proposal) throw new Error(`no proposal produced for: ${content}`);
	return proposal.warnings;
}

test('reversal is flagged on a clean two-turn concession', t => {
	t.true(
		reversalWarnings(
			[
				{role: 'user', content: USER_PREFERENCE_ONLY},
				{role: 'assistant', content: CONCESSION},
			],
			CONCESSION,
		).includes(REVERSAL_WARNING),
	);
});

test('reversal is still flagged when the user message contains a bare slash', t => {
	// "auth/login" is prose, not a file path; it must not count as evidence.
	t.true(
		reversalWarnings(
			[
				{
					role: 'user',
					content:
						'Honestly, for auth/login lazy provider config just feels cleaner to me.',
				},
				{role: 'assistant', content: CONCESSION},
			],
			CONCESSION,
		).includes(REVERSAL_WARNING),
	);
});

test('reversal is still flagged across intervening tool-call turns', t => {
	t.true(
		reversalWarnings(
			[
				{role: 'user', content: USER_PREFERENCE_ONLY},
				{
					role: 'assistant',
					content: '',
					tool_calls: [
						{id: 't1', function: {name: 'read_file', arguments: {}}},
					],
				},
				{
					role: 'tool',
					content: 'file contents',
					tool_call_id: 't1',
					name: 'read_file',
				},
				{role: 'assistant', content: CONCESSION},
			],
			CONCESSION,
		).includes(REVERSAL_WARNING),
	);
});

test('reversal is flagged for agreement openers outside the original six phrases', t => {
	const conceded =
		'Agreed on reflection. The provider config should load lazily, not eagerly.';
	t.true(
		reversalWarnings(
			[
				{role: 'user', content: USER_PREFERENCE_ONLY},
				{role: 'assistant', content: conceded},
			],
			conceded,
		).includes(REVERSAL_WARNING),
	);
});

test('reversal is flagged when a turn contradicts an earlier assistant turn without any opener', t => {
	const reversed =
		'The provider config should load lazily, not eagerly, for this project.';
	t.true(
		reversalWarnings(
			[
				{role: 'user', content: 'How should provider config load?'},
				{
					role: 'assistant',
					content: 'The provider config should load eagerly, not lazily.',
				},
				{role: 'user', content: USER_PREFERENCE_ONLY},
				{role: 'assistant', content: reversed},
			],
			reversed,
		).includes(REVERSAL_WARNING),
	);
});

test('reversal is not flagged when a substantive assistant reply sits in between', t => {
	const conceded = "You're right. Use eager provider config.";
	t.false(
		reversalWarnings(
			[
				{role: 'user', content: 'Honestly lazy just feels cleaner.'},
				{role: 'assistant', content: 'Here is a summary of the current setup.'},
				{role: 'assistant', content: conceded},
			],
			conceded,
		).includes(REVERSAL_WARNING),
	);
});

test('reversal is not flagged for a routine factual assistant turn', t => {
	const fact = 'The storage schema keeps one provider row per workspace.';
	t.false(
		reversalWarnings(
			[
				{role: 'user', content: 'How is the storage laid out here?'},
				{role: 'assistant', content: fact},
			],
			fact,
		).includes(REVERSAL_WARNING),
	);
});

test('SummarizerService bounds the scan window and total proposal count', t => {
	const service = new SummarizerService();
	const messages: Message[] = [];
	// Well past both limits, and old enough that the earliest fall outside the window.
	const total = MAX_SCANNED_MESSAGES + 20;
	for (let i = 0; i < total; i++) {
		messages.push({
			role: 'user',
			content: `Fix the provider retry storage schema bug number ${i}.`,
		});
	}

	const proposals = service.proposeMemoriesFromMessages(messages);

	t.is(proposals.length, MAX_PROPOSALS);
	// The window keeps the newest turns, so the oldest message is not proposed.
	t.false(proposals.some(p => p.content.endsWith('number 0.')));
	t.true(proposals.some(p => p.content.endsWith(`number ${total - 1}.`)));
});
