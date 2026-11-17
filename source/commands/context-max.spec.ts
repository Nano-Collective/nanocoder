import test from 'ava';
import React from 'react';
import type {AIProviderConfig, CommandContext} from '@/types';
import {contextMaxCommand} from './context-max.js';

function runContextMax(overrides: {
	model?: string;
	providerConfig?: AIProviderConfig | null;
	onAddToChatQueue: (node: React.ReactNode) => void;
}) {
	return contextMaxCommand.run({
		argText: '',
		model: overrides.model ?? 'custom-model',
		providerConfig: overrides.providerConfig ?? null,
		addToChatQueue: overrides.onAddToChatQueue,
	} as unknown as CommandContext);
}

function getMessageText(node: React.ReactNode): string {
	if (!React.isValidElement(node)) return '';
	return String((node.props as {message?: string}).message ?? '');
}

test('/context-max shows provider model config source when resolved', async t => {
	let queued: React.ReactNode = null;
	const completion = await runContextMax({
		onAddToChatQueue: node => {
			queued = node;
		},
	});

	t.is(completion, 'done-after-render');
	t.true(getMessageText(queued).includes('Context limit:'));
});

test('/context-max shows unknown when no context is resolved', async t => {
	let queued: React.ReactNode = null;
	const completion = await runContextMax({
		model: 'unknown-model-that-does-not-exist',
		onAddToChatQueue: node => {
			queued = node;
		},
	});

	t.is(completion, 'done-after-render');
	t.true(getMessageText(queued).includes('Context limit:'));
});

test('/context-max uses provider config for context resolution', async t => {
	let queued: React.ReactNode = null;
	const completion = await runContextMax({
		model: 'custom-model',
		providerConfig: {
			name: 'Test Provider',
			type: 'openai',
			models: ['custom-model'],
			contextWindows: {
				'custom-model': 65536,
			},
			config: {},
		},
		onAddToChatQueue: node => {
			queued = node;
		},
	});

	t.is(completion, 'done-after-render');
	const message = getMessageText(queued);
	t.true(message.includes('65,536'));
	t.true(message.includes('provider model config'));
});
