import test from 'ava';
import React from 'react';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {Message} from '@/types/core';
import {createCommitCommand} from './commit';

const baseMessages: Message[] = [
	{role: 'user', content: 'Generate a commit message'},
];

const testMetadata = {
	provider: 'test-provider',
	model: 'test-model',
	tokens: 0,
	getMessageTokens: (m: Message) => m.content.length,
};

function createClient(response: string) {
	return {
		chat: async () => ({
			choices: [
				{
					message: {
						content: response,
					},
				},
			],
		}),
	};
}

test('commitCommand has correct name and description', t => {
	const command = createCommitCommand({
		hasStagedChanges: async () => false,
		execGit: async () => '',
		writeClipboard: async () => {},
	});

	t.is(command.name, 'commit');
	t.is(
		command.description,
		'Generate a conventional commit message from staged changes (--copy)',
	);
});

test('commit warns when no staged changes exist', async t => {
	const command = createCommitCommand({
		hasStagedChanges: async () => false,
		execGit: async () => {
			throw new Error('execGit should not be called');
		},
		writeClipboard: async () => {},
	});

	const result = await command.handler([], baseMessages, testMetadata);

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('No staged changes to commit'));
});

test('commit returns an error when no client is available', async t => {
	const command = createCommitCommand({
		hasStagedChanges: async () => true,
		execGit: async () => 'diff --git a/file.ts b/file.ts',
		writeClipboard: async () => {},
	});

	const result = await command.handler([], baseMessages, {
		...testMetadata,
		client: undefined,
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('No active LLM client available'));
});

test('commit generates a message from the staged diff', async t => {
	let receivedMessages: Message[] = [];

	const command = createCommitCommand({
		hasStagedChanges: async () => true,
		execGit: async args => {
			t.deepEqual(args, [
				'diff',
				'--cached',
				'--no-ext-diff',
				'--no-color',
			]);

			return 'diff --git a/file.ts b/file.ts\n+const value = 1;';
		},
		writeClipboard: async () => {},
	});

	const client = {
		chat: async (messages: Message[]) => {
			receivedMessages = messages;

			return {
				choices: [
					{
						message: {
							content: 'feat: add value constant',
						},
					},
				],
			};
		},
	};

	const result = await command.handler([], baseMessages, {
		...testMetadata,
		client,
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('feat: add value constant'));
	t.is(receivedMessages[0]?.role, 'system');
	t.is(receivedMessages[1]?.role, 'user');
	t.is(
	receivedMessages[1]?.content,
	'diff --git a/file.ts b/file.ts\n+const value = 1;',
);
});

test('commit warns when the model returns an empty response', async t => {
	const command = createCommitCommand({
		hasStagedChanges: async () => true,
		execGit: async () => 'staged diff',
		writeClipboard: async () => {},
	});

	const result = await command.handler([], baseMessages, {
		...testMetadata,
		client: createClient(''),
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Model returned an empty commit message'));
});

test('commit returns an error when the LLM request fails', async t => {
	const command = createCommitCommand({
		hasStagedChanges: async () => true,
		execGit: async () => 'staged diff',
		writeClipboard: async () => {},
	});

	const client = {
		chat: async () => {
			throw new Error('LLM request failed');
		},
	};

	const result = await command.handler([], baseMessages, {
		...testMetadata,
		client,
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('LLM request failed'));
});
// --- --copy flag ---

function createCopyTestCommand(
	writeClipboard: (text: string) => Promise<void>,
) {
	return createCommitCommand({
		hasStagedChanges: async () => true,
		execGit: async () => 'staged diff',
		writeClipboard,
	});
}

test('commit --copy writes the message to the clipboard', async t => {
	const written: string[] = [];
	const command = createCopyTestCommand(async text => {
		written.push(text);
	});

	const result = await command.handler(['--copy'], baseMessages, {
		...testMetadata,
		client: createClient('feat: add value constant'),
	});

	t.deepEqual(
		written,
		['feat: add value constant'],
		'the bare commit message is copied, not the rendered confirmation',
	);

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('feat: add value constant'));
	t.true(output.includes('Copied to clipboard'));
});

test('commit -c is accepted as a short form', async t => {
	const written: string[] = [];
	const command = createCopyTestCommand(async text => {
		written.push(text);
	});

	await command.handler(['-c'], baseMessages, {
		...testMetadata,
		client: createClient('fix: short flag'),
	});

	t.deepEqual(written, ['fix: short flag']);
});

test('commit without --copy leaves the clipboard alone', async t => {
	const command = createCopyTestCommand(async () => {
		t.fail('clipboard must not be touched without the flag');
	});

	const result = await command.handler([], baseMessages, {
		...testMetadata,
		client: createClient('feat: no copy'),
	});

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('feat: no copy'));
	t.false(output.includes('Copied to clipboard'));
});

test('commit --copy still shows the message when the clipboard fails', async t => {
	const command = createCopyTestCommand(async () => {
		throw new Error('no clipboard available');
	});

	const result = await command.handler(['--copy'], baseMessages, {
		...testMetadata,
		client: createClient('chore: headless box'),
	});

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	// Losing a generated message to a missing pbcopy would be the worse failure.
	t.true(output.includes('chore: headless box'));
	t.true(output.includes('Could not copy to clipboard'));
	t.true(output.includes('no clipboard available'));
});

test('commit rejects an unknown option instead of ignoring it', async t => {
	const command = createCommitCommand({
		hasStagedChanges: async () => {
			t.fail('git must not be touched when the args are bad');
			return false;
		},
		execGit: async () => '',
		writeClipboard: async () => {},
	});

	const result = await command.handler(['--clipboard'], baseMessages, {
		...testMetadata,
		client: createClient('feat: unused'),
	});

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Unknown option "--clipboard"'));
	t.true(output.includes('/commit [--copy]'));
});
