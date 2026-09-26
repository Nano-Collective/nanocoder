import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'ava';
import React from 'react';
import type {Message} from '@/types/index';
import {shareCommand} from './share';

const originalWriteFile = fs.writeFile;
let mockWriteFileCalls: Array<{path: string; content: string}> = [];

test.beforeEach(() => {
	mockWriteFileCalls = [];
	// biome-ignore lint/suspicious/noExplicitAny: test mock
	(fs as any).writeFile = async (filepath: string, content: string) => {
		mockWriteFileCalls.push({path: String(filepath), content: String(content)});
		return Promise.resolve(void 0);
	};
});

test.afterEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: restore mock
	(fs as any).writeFile = originalWriteFile;
});

const testMessages: Message[] = [
	{role: 'system', content: 'You are a helpful assistant.'},
	{role: 'user', content: 'Fix the failing build'},
	{
		role: 'assistant',
		content: 'On it.',
		tool_calls: [
			{
				id: 'call_1',
				function: {name: 'bash', arguments: {command: 'npm run build'}},
			},
		],
	},
	{role: 'tool', name: 'bash', content: 'build succeeded'},
];

const testMetadata = {
	provider: 'test-provider',
	model: 'test-model',
	tokens: 42,
	getMessageTokens: (_m: Message) => 0,
};

test('shareCommand has correct name and description', t => {
	t.is(shareCommand.name, 'share');
	t.true(shareCommand.description.length > 0);
});

test('shareCommand returns a React element', async t => {
	const result = await shareCommand.handler(
		['--no-open'],
		testMessages,
		testMetadata,
	);
	t.true(React.isValidElement(result));
});

test('shareCommand writes a self-contained HTML viewer by default', async t => {
	await shareCommand.handler(['--no-open'], testMessages, testMetadata);
	t.is(mockWriteFileCalls.length, 1);
	const {path: filepath, content} = mockWriteFileCalls[0];
	t.true(filepath.endsWith('.html'));
	t.true(content.includes('<!doctype html>'));
	t.true(content.includes('type="application/json"'));
	// System messages are excluded from the shared trajectory.
	t.false(content.includes('You are a helpful assistant.'));
});

test('shareCommand --json writes deterministic JSON', async t => {
	await shareCommand.handler(['--json'], testMessages, testMetadata);
	t.is(mockWriteFileCalls.length, 1);
	const {path: filepath, content} = mockWriteFileCalls[0];
	t.true(filepath.endsWith('.json'));
	const parsed = JSON.parse(content);
	t.is(parsed.version, 1);
	t.is(parsed.provider, 'test-provider');
	t.is(parsed.model, 'test-model');
	t.is(parsed.totalTokens, 42);
	// system message dropped -> user, assistant, tool = 3
	t.is(parsed.messageCount, 3);
	t.is(parsed.messages[1].toolCalls[0].name, 'bash');
});

test('shareCommand escapes </script> to keep the JSON tag intact', async t => {
	const messages: Message[] = [
		{role: 'user', content: 'break out </script><script>alert(1)</script>'},
	];
	await shareCommand.handler(['--no-open'], messages, testMetadata);
	const {content} = mockWriteFileCalls[0];
	t.false(content.includes('</script><script>alert(1)'));
	t.true(content.includes('\\u003c/script'));
});

test('shareCommand defaults to the temp dir for bare filenames', async t => {
	await shareCommand.handler(
		['--no-open', 'my-session.html'],
		testMessages,
		testMetadata,
	);
	t.is(mockWriteFileCalls[0].path, path.join(os.tmpdir(), 'my-session.html'));
});

test('shareCommand honors an explicit path', async t => {
	await shareCommand.handler(
		['--no-open', './out/session.html'],
		testMessages,
		testMetadata,
	);
	t.is(
		mockWriteFileCalls[0].path,
		path.resolve(process.cwd(), './out/session.html'),
	);
});

test('shareCommand reports nothing to share for an empty session', async t => {
	const result = await shareCommand.handler(
		['--no-open'],
		[{role: 'system', content: 'prompt'}],
		testMetadata,
	);
	t.true(React.isValidElement(result));
	t.is(mockWriteFileCalls.length, 0);
});
