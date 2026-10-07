import test from 'ava';
import React from 'react';
import type {SemanticMemory} from '@/memory/semantic-memory-manager';
import {SummarizerService} from '@/memory/summarizer-service';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {Message} from '@/types/core';
import {lazyCommands} from './lazy-registry.js';
import {createRememberCommand, rememberCommand} from './remember.js';

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

test('rememberCommand has correct name and description', t => {
	t.is(rememberCommand.name, 'remember');
	t.is(rememberCommand.description, 'Save a durable project memory');
});

test('remember command returns usage when content is missing', async t => {
	const result = await rememberCommand.handler([], [], testMetadata);
	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() ?? '';

	t.true(output.includes('Usage: /remember'));
});

test('remember command saves a manual memory', async t => {
	const service = new FakeSummarizerService({
		id: 'memory-1',
		content: 'Use the existing auth adapter.',
		category: 'architecture',
		timestamp: '2026-07-15T00:00:00.000Z',
	});
	const command = createRememberCommand({summarizerService: service});

	const result = await command.handler(
		['Use', 'the', 'existing', 'auth', 'adapter.'],
		[],
		testMetadata,
	);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.deepEqual(service.rememberedInput, {
		content: 'Use the existing auth adapter.',
		category: undefined,
	});
	t.true((lastFrame() ?? '').includes('Remembered architecture memory.'));
});

test('remember command forwards explicit category', async t => {
	const service = new FakeSummarizerService({
		id: 'memory-1',
		content: 'Keep generated files out of review.',
		category: 'codingStyle',
		timestamp: '2026-07-15T00:00:00.000Z',
	});
	const command = createRememberCommand({summarizerService: service});

	await command.handler(
		[
			'--category',
			'coding-style',
			'Keep',
			'generated',
			'files',
			'out',
			'of',
			'review.',
		],
		[],
		testMetadata,
	);

	t.deepEqual(service.rememberedInput, {
		content: 'Keep generated files out of review.',
		category: 'coding-style',
	});
});

test('remember command reports save failures', async t => {
	const service = new FakeSummarizerService(
		{
			id: 'memory-1',
			content: 'Use the existing auth adapter.',
			category: 'architecture',
			timestamp: '2026-07-15T00:00:00.000Z',
		},
		new Error('disk full'),
	);
	const command = createRememberCommand({summarizerService: service});

	const result = await command.handler(
		['Use', 'the', 'existing', 'auth', 'adapter.'],
		[],
		testMetadata,
	);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);

	t.true((lastFrame() ?? '').includes('Failed to save memory: disk full'));
});

test('lazy registry exposes /remember', t => {
	const remember = lazyCommands.find(command => command.name === 'remember');

	t.truthy(remember);
	t.is(remember?.description, 'Save a durable project memory');
});
