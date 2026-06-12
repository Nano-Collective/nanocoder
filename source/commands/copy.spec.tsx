import test from 'ava';
import React from 'react';
import clipboard from 'clipboardy';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {Message} from '@/types/core';
import {copyCommand} from './copy';

// In a CI/Linux sandbox clipboardy.write may not have a backing binary
// installed (it shells out to xclip/xsel/pbcopy/clip.exe). For tests we
// stub the write method directly on the default export object — this is
// the same monkey-patching approach export.spec.tsx uses for fs.writeFile.
const originalWrite = clipboard.write;
let lastWritten: string | null = null;
let writeImpl: (text: string) => Promise<void> = async text => {
	lastWritten = text;
};

test.beforeEach(() => {
	lastWritten = null;
	writeImpl = async text => {
		lastWritten = text;
	};
	(clipboard as {write: (text: string) => Promise<void>}).write = text =>
		writeImpl(text);
});

test.afterEach(() => {
	(clipboard as {write: (text: string) => Promise<void>}).write = originalWrite;
});

const testMetadata = {
	provider: 'test-provider',
	model: 'test-model',
	tokens: 0,
	getMessageTokens: (m: Message) => m.content.length,
};

const baseMessages: Message[] = [
	{role: 'user', content: 'Tell me a joke'},
	{role: 'assistant', content: 'Why did the chicken cross the road?'},
	{role: 'user', content: 'I don\'t know, why?'},
	{role: 'assistant', content: 'To get to the other side.'},
];

test('copyCommand has correct name and description', t => {
	t.is(copyCommand.name, 'copy');
	t.is(
		copyCommand.description,
		'Copy the last assistant response to the clipboard',
	);
});

test('copyCommand writes the last assistant content to the clipboard', async t => {
	await copyCommand.handler([], baseMessages, testMetadata);

	t.is(lastWritten, 'To get to the other side.');
});

test('copyCommand returns a React success message on success', async t => {
	const result = await copyCommand.handler(
		[],
		baseMessages,
		testMetadata,
	);
	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Copied last response to clipboard'));
	// The success message should NOT include the copied content itself
	// (the user just ran /copy — they already know what they copied).
	t.false(output.includes('To get to the other side'));
});

test('copyCommand warns when no assistant response exists', async t => {
	const messages: Message[] = [
		{role: 'user', content: 'Hello?'},
		{role: 'system', content: 'You are a helpful assistant'},
	];

	const result = await copyCommand.handler([], messages, testMetadata);
	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('No assistant response to copy yet'));
	t.is(lastWritten, null);
});

test('copyCommand warns when last assistant message has empty content', async t => {
	const messages: Message[] = [
		{role: 'user', content: 'Hello?'},
		{role: 'assistant', content: ''},
	];

	const result = await copyCommand.handler([], messages, testMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('No assistant response to copy yet'));
	t.is(lastWritten, null);
});

test('copyCommand returns an error message when clipboard write fails', async t => {
	writeImpl = async () => {
		throw new Error('no clipboard tool available');
	};

	const result = await copyCommand.handler([], baseMessages, testMetadata);
	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Failed to copy to clipboard'));
	t.true(output.includes('no clipboard tool available'));
});

test('copyCommand ignores trailing non-assistant messages', async t => {
	// Even if there are tool/system messages after the assistant, the
	// last assistant content should still be the one copied.
	const messages: Message[] = [
		...baseMessages,
		{role: 'tool', name: 'echo', content: 'noise'},
		{role: 'system', content: 'system note'},
	];

	await copyCommand.handler([], messages, testMetadata);
	t.is(lastWritten, 'To get to the other side.');
});
