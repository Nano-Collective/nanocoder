import test from 'ava';
import React from 'react';
import {getSessionContextLimit, resetSessionContextLimit} from '@/models/index';
import type {AIProviderConfig, CommandContext} from '@/types';
import {contextMaxCommand} from './context-max.js';

function runContextMax(overrides: {
	argText?: string;
	model?: string;
	providerConfig?: AIProviderConfig | null;
	onAddToChatQueue: (node: React.ReactNode) => void;
}) {
	return contextMaxCommand.run({
		argText: overrides.argText ?? '',
		model: overrides.model ?? 'custom-model',
		providerConfig: overrides.providerConfig ?? null,
		addToChatQueue: overrides.onAddToChatQueue,
	} as unknown as CommandContext);
}

function getMessageText(node: React.ReactNode): string {
	if (!React.isValidElement(node)) return '';
	return String((node.props as {message?: string}).message ?? '');
}

test.beforeEach(() => {
	resetSessionContextLimit();
});

test.afterEach.always(() => {
	resetSessionContextLimit();
});

test('/context-max exposes description with k and m examples', t => {
	t.true(contextMaxCommand.description.includes('/context-max 128k'));
	t.true(contextMaxCommand.description.includes('/context-max 1m'));
});

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

test('/context-max shows unknown with suffix usage hint when no context is resolved', async t => {
	let queued: React.ReactNode = null;
	const completion = await runContextMax({
		model: 'unknown-model-that-does-not-exist',
		onAddToChatQueue: node => {
			queued = node;
		},
	});

	t.is(completion, 'done-after-render');
	t.is(
		getMessageText(queued),
		'Context limit: Unknown. Use /context-max <number>[k|m] to set one.',
	);
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

test('/context-max sets valid integer, bare decimal, k/K, m/M, and fractional suffixed values', async t => {
	const cases: Array<[string, number]> = [
		['8192', 8192],
		['1024.5', 1025],
		['0.5', 1],
		['128k', 128000],
		['128K', 128000],
		['4.5k', 4500],
		['1m', 1000000],
		['1M', 1000000],
		['1.5m', 1500000],
		['2.5M', 2500000],
	];

	for (const [input, expected] of cases) {
		let queued: React.ReactNode = null;
		const completion = await runContextMax({
			argText: input,
			onAddToChatQueue: node => {
				queued = node;
			},
		});

		t.is(completion, 'done-after-render', input);
		t.is(getSessionContextLimit(), expected, input);
		t.true(
			getMessageText(queued).includes(expected.toLocaleString()),
			`${input} -> ${getMessageText(queued)}`,
		);
	}
});

test('/context-max --reset clears the session override', async t => {
	let queued: React.ReactNode = null;
	await runContextMax({
		argText: '1m',
		onAddToChatQueue: node => {
			queued = node;
		},
	});
	t.is(getSessionContextLimit(), 1000000);

	const completion = await runContextMax({
		argText: '--reset',
		onAddToChatQueue: node => {
			queued = node;
		},
	});

	t.is(completion, 'done-after-render');
	t.is(getSessionContextLimit(), null);
	t.is(getMessageText(queued), 'Session context limit override cleared.');
});

test('/context-max rejects zero, negative, invalid, overflowing, and unsafe values with updated error message', async t => {
	const invalidInputs = [
		'0',
		'-100',
		'abc',
		'1b',
		'1.5x',
		'9007199254740992',
		'9007199254740991k',
		'9'.repeat(400),
		`${'9'.repeat(308)}k`,
	];

	for (const input of invalidInputs) {
		let queued: React.ReactNode = null;
		const completion = await runContextMax({
			argText: input,
			onAddToChatQueue: node => {
				queued = node;
			},
		});

		t.is(completion, 'done-after-render', input);
		t.is(getSessionContextLimit(), null, input);
		t.is(
			getMessageText(queued),
			'Invalid context limit. Use a positive number, e.g. /context-max 8192, /context-max 128k, or /context-max 1m',
			input,
		);
	}
});
