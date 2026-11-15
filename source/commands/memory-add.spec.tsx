import test from 'ava';
import React from 'react';
import type {SemanticMemory} from '@/memory/semantic-memory-manager';
import {SummarizerService} from '@/memory/summarizer-service';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {Message} from '@/types/core';
import {expandCommandAlias} from './aliases.js';
import {createMemoryCommand} from './memory.js';

// `/memory add` replaced `/remember`, which still works as an alias.

const testMetadata = {
	provider: 'test-provider',
	model: 'test-model',
	tokens: 0,
	getMessageTokens: (message: Message) => message.content.length,
};

class FakeSummarizerService extends SummarizerService {
	rememberedInput?: {
		content: string;
		category?: string;
		sourceSessionId?: string;
	};

	constructor(
		private readonly memory: SemanticMemory,
		private readonly error?: Error,
	) {
		super();
	}

	override async remember(input: {
		content: string;
		category?: string;
		sourceSessionId?: string;
	}): Promise<SemanticMemory> {
		this.rememberedInput = input;
		if (this.error) throw this.error;
		return this.memory;
	}
}

function render(result: unknown): string {
	return renderWithTheme(result as React.ReactElement).lastFrame() ?? '';
}

const savedMemory: SemanticMemory = {
	id: 'memory-1',
	content: 'Use the existing auth adapter.',
	category: 'architecture',
	timestamp: '2026-07-15T00:00:00.000Z',
};

test('memory add returns usage when content is missing', async t => {
	const command = createMemoryCommand({
		summarizerService: new FakeSummarizerService(savedMemory),
	});
	const result = await command.handler(['add'], [], testMetadata);
	t.truthy(React.isValidElement(result));
	t.true(render(result).includes('Usage: /memory add'));
});

test('memory add returns usage when --category has no value', async t => {
	const service = new FakeSummarizerService(savedMemory);
	const command = createMemoryCommand({summarizerService: service});
	const result = await command.handler(
		['add', '--category'],
		[],
		testMetadata,
	);
	t.true(render(result).includes('Usage: /memory add'));
	t.is(service.rememberedInput, undefined);
});

test('memory add saves a manual memory', async t => {
	const service = new FakeSummarizerService(savedMemory);
	const command = createMemoryCommand({summarizerService: service});

	const result = await command.handler(
		['add', 'Use', 'the', 'existing', 'auth', 'adapter.'],
		[],
		testMetadata,
	);

	t.deepEqual(service.rememberedInput, {
		content: 'Use the existing auth adapter.',
		category: undefined,
	});
	t.true(render(result).includes('Remembered architecture memory.'));
});

test('memory add forwards an explicit category (long and short flag)', async t => {
	for (const flag of ['--category', '-c']) {
		const service = new FakeSummarizerService(savedMemory);
		const command = createMemoryCommand({summarizerService: service});

		await command.handler(
			['add', flag, 'coding-style', 'Keep', 'generated', 'files', 'out.'],
			[],
			testMetadata,
		);

		t.deepEqual(service.rememberedInput, {
			content: 'Keep generated files out.',
			category: 'coding-style',
		});
	}
});

test('memory add reports save failures', async t => {
	const service = new FakeSummarizerService(
		savedMemory,
		new Error('disk full'),
	);
	const command = createMemoryCommand({summarizerService: service});

	const result = await command.handler(
		['add', 'Use', 'the', 'existing', 'auth', 'adapter.'],
		[],
		testMetadata,
	);

	t.true(render(result).includes('Failed to save memory: disk full'));
});

test('/remember expands to /memory add with its arguments intact', async t => {
	const expanded = expandCommandAlias('/remember -c todo Ship the docs');
	t.is(expanded, '/memory add -c todo Ship the docs');

	const service = new FakeSummarizerService(savedMemory);
	const command = createMemoryCommand({summarizerService: service});
	const [, ...args] = expanded.slice(1).split(/\s+/);
	await command.handler(args, [], testMetadata);

	t.deepEqual(service.rememberedInput, {
		content: 'Ship the docs',
		category: 'todo',
	});
});
