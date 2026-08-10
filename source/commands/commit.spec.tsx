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
	});

	t.is(command.name, 'commit');
	t.is(
		command.description,
		'Generate a conventional commit message from staged changes',
	);
});

test('commit warns when no staged changes exist', async t => {
	const command = createCommitCommand({
		hasStagedChanges: async () => false,
		execGit: async () => {
			throw new Error('execGit should not be called');
		},
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