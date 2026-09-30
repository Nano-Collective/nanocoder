import test from 'ava';
import React from 'react';
import {ProposalStore} from '@/memory/proposal-store';
import type {SemanticMemory} from '@/memory/semantic-memory-manager';
import type {MemoryProposal} from '@/memory/summarizer-service';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {Message} from '@/types/core';
import {lazyCommands} from './lazy-registry.js';
import {createMemoryCommand, memoryCommand} from './memory.js';

const testMetadata = {
	provider: 'test-provider',
	model: 'test-model',
	tokens: 0,
	getMessageTokens: (message: Message) => message.content.length,
};

class FakeMemoryManager {
	memories: SemanticMemory[] = [];
	cleared = false;

	async listMemories(): Promise<SemanticMemory[]> {
		return this.memories;
	}

	async deleteMemory(id: string): Promise<boolean> {
		const before = this.memories.length;
		this.memories = this.memories.filter(memory => memory.id !== id);
		return this.memories.length !== before;
	}

	async clearMemories(): Promise<void> {
		this.cleared = true;
		this.memories = [];
	}
}

class FakeSummarizerService {
	accepted: Array<Pick<MemoryProposal, 'content' | 'category'>> = [];
	sessionIds: Array<string | undefined> = [];

	constructor(private readonly proposals: MemoryProposal[]) {}

	proposeMemoriesFromMessages(messages: Message[]): MemoryProposal[] {
		return messages.length === 0 ? [] : this.proposals;
	}

	async acceptProposal(
		proposal: Pick<MemoryProposal, 'content' | 'category'>,
		sourceSessionId?: string,
	): Promise<SemanticMemory> {
		this.accepted.push({content: proposal.content, category: proposal.category});
		this.sessionIds.push(sourceSessionId);
		return {
			id: `accepted-${this.accepted.length}`,
			content: proposal.content,
			category: proposal.category,
			timestamp: '2026-08-05T00:00:00.000Z',
		};
	}
}

test('memoryCommand has correct name and description', t => {
	t.is(memoryCommand.name, 'memory');
	t.is(memoryCommand.description, 'Manage project memories');
});

test('memory command lists empty state', async t => {
	const manager = new FakeMemoryManager();
	const command = createMemoryCommand({memoryManager: manager});

	const result = await command.handler(['list'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true((lastFrame() ?? '').includes('No project memories saved.'));
});

test('memory command lists saved memories', async t => {
	const manager = new FakeMemoryManager();
	manager.memories = [
		{
			id: 'memory-1',
			content: 'Auth uses Clerk.',
			category: 'architecture',
			timestamp: '2026-07-21T00:00:00.000Z',
		},
	];
	const command = createMemoryCommand({memoryManager: manager});

	const result = await command.handler(['list'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() ?? '';

	// Listed by short id rather than the raw UUID.
	t.true(output.includes('memory1'));
	t.true(output.includes('architecture'));
	t.true(output.includes('Auth uses Clerk.'));
});

test('memory command deletes a memory', async t => {
	const manager = new FakeMemoryManager();
	manager.memories = [
		{
			id: 'memory-1',
			content: 'Auth uses Clerk.',
			category: 'architecture',
			timestamp: '2026-07-21T00:00:00.000Z',
		},
	];
	const command = createMemoryCommand({memoryManager: manager});

	const result = await command.handler(['delete', 'memory-1'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true((lastFrame() ?? '').includes('Deleted memory: memory1'));
	t.deepEqual(manager.memories, []);
});

test('memory command reports missing memory delete', async t => {
	const manager = new FakeMemoryManager();
	const command = createMemoryCommand({memoryManager: manager});

	const result = await command.handler(['delete', 'missing'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true((lastFrame() ?? '').includes('Memory not found: missing'));
});

test('memory command clears memories', async t => {
	const manager = new FakeMemoryManager();
	manager.memories = [
		{
			id: 'memory-1',
			content: 'Auth uses Clerk.',
			category: 'architecture',
			timestamp: '2026-07-21T00:00:00.000Z',
		},
	];
	const command = createMemoryCommand({memoryManager: manager});

	const result = await command.handler(['clear'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true(manager.cleared);
	t.true((lastFrame() ?? '').includes('Cleared project memories.'));
});

test('memory command shows usage for unknown subcommand', async t => {
	const manager = new FakeMemoryManager();
	const command = createMemoryCommand({memoryManager: manager});

	const result = await command.handler(['unknown'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true((lastFrame() ?? '').includes('Usage: /memory'));
});

test('memory command proposes durable memories from current messages', async t => {
	const manager = new FakeMemoryManager();
	const command = createMemoryCommand({
		memoryManager: manager,
		summarizerService: new FakeSummarizerService([
			{
				content: 'Auth uses Clerk.',
				category: 'architecture',
				sourceType: 'explicit-user',
				evidence: {
					userMessages: ['Refactor auth.'],
					assistantMessages: [],
				},
				warnings: [],
			},
		]),
	});

	const result = await command.handler(
		['propose'],
		[
			{
				role: 'user',
				content: 'Refactor auth.',
			},
		],
		testMetadata,
	);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() ?? '';

	t.true(output.includes('[architecture]'));
	t.true(output.includes('Auth uses Clerk.'));
});

test('memory command reports when no proposals are found', async t => {
	const manager = new FakeMemoryManager();
	const command = createMemoryCommand({
		memoryManager: manager,
		summarizerService: new FakeSummarizerService([]),
	});

	const result = await command.handler(['propose'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true((lastFrame() ?? '').includes('No durable memory proposals found.'));
});

test('memory command accepts a proposal by index after propose', async t => {
	const manager = new FakeMemoryManager();
	const summarizerService = new FakeSummarizerService([
		{
			content: 'Auth uses Clerk.',
			category: 'architecture',
			sourceType: 'explicit-user',
			evidence: {userMessages: ['Refactor auth.'], assistantMessages: []},
			warnings: [],
		},
	]);
	const command = createMemoryCommand({memoryManager: manager, summarizerService});

	await command.handler(['propose'], [{role: 'user', content: 'Refactor auth.'}], testMetadata);
	const result = await command.handler(['accept', '1'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true((lastFrame() ?? '').includes('Saved architecture memory: Auth uses Clerk.'));
	t.deepEqual(summarizerService.accepted, [
		{content: 'Auth uses Clerk.', category: 'architecture'},
	]);
	t.deepEqual(summarizerService.sessionIds, [undefined]);
});

test('memory command passes the current session id when accepting a proposal', async t => {
	const manager = new FakeMemoryManager();
	const summarizerService = new FakeSummarizerService([
		{
			content: 'Auth uses Clerk.',
			category: 'architecture',
			sourceType: 'explicit-user',
			evidence: {userMessages: ['Refactor auth.'], assistantMessages: []},
			warnings: [],
		},
	]);
	const command = createMemoryCommand({memoryManager: manager, summarizerService});

	await command.handler(['propose'], [{role: 'user', content: 'Refactor auth.'}], testMetadata);
	await command.handler(['accept', '1'], [], {
		...testMetadata,
		sessionId: 'session-1',
	});

	t.deepEqual(summarizerService.sessionIds, ['session-1']);
});

test('memory command rejects accept with no prior proposals', async t => {
	const manager = new FakeMemoryManager();
	const command = createMemoryCommand({
		memoryManager: manager,
		summarizerService: new FakeSummarizerService([]),
	});

	const result = await command.handler(['accept', '1'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true(
		(lastFrame() ?? '').includes('No proposals to accept. Run /memory propose first.'),
	);
});

test('memory command rejects accept with an out-of-range index', async t => {
	const manager = new FakeMemoryManager();
	const summarizerService = new FakeSummarizerService([
		{
			content: 'Auth uses Clerk.',
			category: 'architecture',
			sourceType: 'explicit-user',
			evidence: {userMessages: ['Refactor auth.'], assistantMessages: []},
			warnings: [],
		},
	]);
	const command = createMemoryCommand({memoryManager: manager, summarizerService});

	await command.handler(['propose'], [{role: 'user', content: 'Refactor auth.'}], testMetadata);
	const result = await command.handler(['accept', '5'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true((lastFrame() ?? '').includes('Usage: /memory accept <1-1>'));
	t.deepEqual(summarizerService.accepted, []);
});

test('lazy registry exposes /memory', t => {
	const memory = lazyCommands.find(command => command.name === 'memory');

	t.truthy(memory);
	t.is(memory?.description, 'Manage project memories');
});

// --- Accept indexing: the round-3 review's merge blocker. Accepting a proposal
// must not renumber the list the user is still reading off screen. ---

function proposal(content: string, category = 'architecture'): MemoryProposal {
	return {
		content,
		category,
		sourceType: 'explicit-user',
		evidence: {userMessages: [content], assistantMessages: []},
		warnings: [],
	};
}

const FOUR_PROPOSALS = [
	proposal('Proposal one.'),
	proposal('Proposal two.'),
	proposal('Proposal three.'),
	proposal('Proposal four.'),
];

test('memory accept keeps indices stable across successive accepts', async t => {
	const summarizerService = new FakeSummarizerService(FOUR_PROPOSALS);
	const command = createMemoryCommand({
		memoryManager: new FakeMemoryManager(),
		summarizerService,
	});

	await command.handler(
		['propose'],
		[{role: 'user', content: 'seed'}],
		testMetadata,
	);
	await command.handler(['accept', '2'], [], testMetadata);
	await command.handler(['accept', '3'], [], testMetadata);

	// Before the fix the second accept saved "Proposal four." because the list
	// was re-indexed after the first accept.
	t.deepEqual(summarizerService.accepted, [
		{content: 'Proposal two.', category: 'architecture'},
		{content: 'Proposal three.', category: 'architecture'},
	]);
});

test('memory accept refuses to save the same proposal twice', async t => {
	const summarizerService = new FakeSummarizerService(FOUR_PROPOSALS);
	const command = createMemoryCommand({
		memoryManager: new FakeMemoryManager(),
		summarizerService,
	});

	await command.handler(
		['propose'],
		[{role: 'user', content: 'seed'}],
		testMetadata,
	);
	await command.handler(['accept', '2'], [], testMetadata);
	const result = await command.handler(['accept', '2'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true((lastFrame() ?? '').includes('Proposal 2 was already saved.'));
	t.is(summarizerService.accepted.length, 1);
});

test('memory accept is reset when the proposal store is cleared', async t => {
	const store = new ProposalStore();
	const summarizerService = new FakeSummarizerService(FOUR_PROPOSALS);
	const command = createMemoryCommand({
		memoryManager: new FakeMemoryManager(),
		summarizerService,
		proposalStore: store,
	});

	await command.handler(
		['propose'],
		[{role: 'user', content: 'seed'}],
		testMetadata,
	);
	// What /clear does.
	store.clear();

	const result = await command.handler(['accept', '1'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true(
		(lastFrame() ?? '').includes('No proposals to accept. Run /memory propose first.'),
	);
	t.deepEqual(summarizerService.accepted, []);
});

// --- Short ids ---

const UUID_A = '18d51c0d-becb-4efc-8d0d-b8c1f3b61802';
const UUID_B = '18d51c0d-0000-4efc-8d0d-b8c1f3b61802';
const UUID_C = 'ff000000-1111-4efc-8d0d-b8c1f3b61802';

function storedMemory(id: string, content: string): SemanticMemory {
	return {
		id,
		content,
		category: 'architecture',
		timestamp: '2026-07-21T00:00:00.000Z',
	};
}

test('memory list shows a short id instead of the raw UUID', async t => {
	const manager = new FakeMemoryManager();
	manager.memories = [storedMemory(UUID_A, 'Auth uses Clerk.')];
	const command = createMemoryCommand({memoryManager: manager});

	const result = await command.handler(['list'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() ?? '';

	t.true(output.includes('18d51c0d'));
	t.false(output.includes(UUID_A));
});

test('memory delete accepts a short id', async t => {
	const manager = new FakeMemoryManager();
	manager.memories = [storedMemory(UUID_C, 'Auth uses Clerk.')];
	const command = createMemoryCommand({memoryManager: manager});

	const result = await command.handler(['delete', 'ff000000'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true((lastFrame() ?? '').includes('Deleted memory: ff000000'));
	t.deepEqual(manager.memories, []);
});

test('memory delete still accepts a full UUID', async t => {
	const manager = new FakeMemoryManager();
	manager.memories = [storedMemory(UUID_C, 'Auth uses Clerk.')];
	const command = createMemoryCommand({memoryManager: manager});

	await command.handler(['delete', UUID_C], [], testMetadata);

	t.deepEqual(manager.memories, []);
});

test('memory delete reports an ambiguous short id instead of guessing', async t => {
	const manager = new FakeMemoryManager();
	manager.memories = [
		storedMemory(UUID_A, 'Auth uses Clerk.'),
		storedMemory(UUID_B, 'Storage uses SQLite.'),
	];
	const command = createMemoryCommand({memoryManager: manager});

	const result = await command.handler(['delete', '18d51c0d'], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true((lastFrame() ?? '').includes('Ambiguous memory id'));
	t.is(manager.memories.length, 2);
});

test('bare /memory defaults to list', async t => {
	const manager = new FakeMemoryManager();
	const command = createMemoryCommand({memoryManager: manager});

	const result = await command.handler([], [], testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true((lastFrame() ?? '').includes('No project memories saved.'));
});

test('memory ls and rm aliases behave like list and delete', async t => {
	const manager = new FakeMemoryManager();
	manager.memories = [storedMemory(UUID_C, 'Auth uses Clerk.')];
	const command = createMemoryCommand({memoryManager: manager});

	const listed = await command.handler(['ls'], [], testMetadata);
	t.true(
		(renderWithTheme(listed as React.ReactElement).lastFrame() ?? '').includes(
			'Auth uses Clerk.',
		),
	);

	await command.handler(['rm', 'ff000000'], [], testMetadata);
	t.deepEqual(manager.memories, []);
});
