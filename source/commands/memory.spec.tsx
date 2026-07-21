import test from 'ava';
import React from 'react';
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
	constructor(private readonly proposals: MemoryProposal[]) {}

	proposeMemoriesFromMessages(messages: Message[]): MemoryProposal[] {
		return messages.length === 0 ? [] : this.proposals;
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

	t.true(output.includes('memory-1'));
	t.true(output.includes('[architecture]'));
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

	t.true((lastFrame() ?? '').includes('Deleted memory: memory-1'));
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

test('lazy registry exposes /memory', t => {
	const memory = lazyCommands.find(command => command.name === 'memory');

	t.truthy(memory);
	t.is(memory?.description, 'Manage project memories');
});
