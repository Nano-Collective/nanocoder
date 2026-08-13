import test from 'ava';
import type {LLMClient} from '@/types/core';
import {
	buildTitleRequest,
	extractToolSummaries,
	generateSessionTitle,
	isWeakTitle,
	normalizeFirstMessage,
	sanitizeTitle,
} from './title-generator.js';

test('normalizeFirstMessage strips the active-file prefix', t => {
	const input = '[Active file: source/app/App.tsx]\n\nfix the crash';
	t.is(normalizeFirstMessage(input), 'fix the crash');
});

test('normalizeFirstMessage keeps only the first line', t => {
	t.is(normalizeFirstMessage('first line\nsecond line'), 'first line');
});

test('normalizeFirstMessage trims and collapses inner whitespace', t => {
	t.is(normalizeFirstMessage('  fix   the    bug  '), 'fix the bug');
});

test('isWeakTitle table', t => {
	t.true(isWeakTitle('hi'));
	t.true(isWeakTitle('fix this'));
	t.true(isWeakTitle('hello nanocoder'));
	t.true(isWeakTitle('fix the auth bug'));
	t.true(isWeakTitle('why is the login test failing'));
	t.true(isWeakTitle('ログイン処理のバグを直して'));
	t.false(
		isWeakTitle('refactor session-manager to use atomic writes everywhere'),
	);
});

test('isWeakTitle measures the normalized string, not the raw one', t => {
	// Real content behind a prefix that would otherwise inflate the length.
	const withPrefix =
		'[Active file: a.ts]\n\nrefactor session-manager to use atomic writes everywhere';
	t.false(isWeakTitle(withPrefix));
	// A long prefix must not rescue a short message.
	t.true(isWeakTitle('[Active file: some/very/long/path/to/a/file.ts]\n\nhi'));
});

test('extractToolSummaries pairs tool names with their path argument', t => {
	const messages = [
		{role: 'user' as const, content: 'fix this'},
		{
			role: 'assistant' as const,
			content: '',
			tool_calls: [
				{
					id: '1',
					function: {
						name: 'read_file',
						arguments: {path: 'source/auth/login.ts'},
					},
				},
				{
					id: '2',
					function: {
						name: 'string_replace',
						arguments: {file_path: 'source/auth/login.ts'},
					},
				},
			],
		},
	];
	t.deepEqual(extractToolSummaries(messages), [
		'read_file: source/auth/login.ts',
		'string_replace: source/auth/login.ts',
	]);
});

test('extractToolSummaries falls back to the bare name with no path arg', t => {
	const messages = [
		{
			role: 'assistant' as const,
			content: '',
			tool_calls: [
				{id: '1', function: {name: 'list_directory', arguments: {}}},
			],
		},
	];
	t.deepEqual(extractToolSummaries(messages), ['list_directory']);
});

test('extractToolSummaries returns empty when no tools ran', t => {
	const messages = [
		{role: 'user' as const, content: 'hi'},
		{role: 'assistant' as const, content: 'Hello.'},
	];
	t.deepEqual(extractToolSummaries(messages), []);
});

test('extractToolSummaries caps at 10 entries', t => {
	const messages = [
		{
			role: 'assistant' as const,
			content: '',
			tool_calls: Array.from({length: 25}, (_v, i) => ({
				id: String(i),
				function: {name: `tool_${i}`, arguments: {}},
			})),
		},
	];
	t.is(extractToolSummaries(messages).length, 10);
});

test('sanitizeTitle strips wrapping quotes', t => {
	t.is(sanitizeTitle('"Fix Login Redirect"'), 'Fix Login Redirect');
	t.is(sanitizeTitle("'Fix Login Redirect'"), 'Fix Login Redirect');
});

test('sanitizeTitle strips a leading Title: prefix', t => {
	t.is(sanitizeTitle('Title: Fix Login Redirect'), 'Fix Login Redirect');
});

test('sanitizeTitle strips markdown emphasis', t => {
	t.is(sanitizeTitle('**Fix Login Redirect**'), 'Fix Login Redirect');
});

test('sanitizeTitle strips trailing punctuation', t => {
	t.is(sanitizeTitle('Fix Login Redirect.'), 'Fix Login Redirect');
});

test('sanitizeTitle takes only the first non-empty line', t => {
	t.is(
		sanitizeTitle('\n\nFix Login Redirect\nsome rambling'),
		'Fix Login Redirect',
	);
});

test('sanitizeTitle rejects a paragraph rather than truncating it', t => {
	const paragraph =
		'Sure! Here is a title that describes the session in detail, ' +
		'covering the authentication work and the various files that were ' +
		'touched during the course of this particular conversation session.';
	t.is(sanitizeTitle(paragraph), null);
});

test('sanitizeTitle returns null for empty or whitespace input', t => {
	t.is(sanitizeTitle(''), null);
	t.is(sanitizeTitle('   \n  '), null);
	t.is(sanitizeTitle('""'), null);
});

test('buildTitleRequest truncates the first user message to 500 chars', t => {
	const messages = buildTitleRequest({
		firstUserMessage: 'x'.repeat(900),
		toolSummaries: [],
	});
	const userContent = messages[messages.length - 1].content;
	t.false(userContent.includes('x'.repeat(501)));
	t.true(userContent.includes('x'.repeat(500)));
});

test('buildTitleRequest truncates each tool summary to 100 chars', t => {
	const messages = buildTitleRequest({
		firstUserMessage: 'fix this',
		toolSummaries: [`read_file: ${'y'.repeat(300)}`],
	});
	const userContent = messages[messages.length - 1].content;
	t.false(userContent.includes('y'.repeat(101)));
});

test('buildTitleRequest uses the assistant reply only when no tools ran', t => {
	const withTools = buildTitleRequest({
		firstUserMessage: 'fix this',
		toolSummaries: ['read_file: a.ts'],
		assistantReply: 'I looked at the parser.',
	});
	t.false(
		withTools[withTools.length - 1].content.includes(
			'I looked at the parser.',
		),
	);

	const withoutTools = buildTitleRequest({
		firstUserMessage: 'fix this',
		toolSummaries: [],
		assistantReply: 'I looked at the parser.',
	});
	t.true(
		withoutTools[withoutTools.length - 1].content.includes(
			'I looked at the parser.',
		),
	);
});

test('buildTitleRequest truncates the assistant reply to 300 chars', t => {
	const messages = buildTitleRequest({
		firstUserMessage: 'fix this',
		toolSummaries: [],
		assistantReply: 'z'.repeat(800),
	});
	const userContent = messages[messages.length - 1].content;
	t.false(userContent.includes('z'.repeat(301)));
});

test('buildTitleRequest opens with a system message', t => {
	const messages = buildTitleRequest({
		firstUserMessage: 'fix this',
		toolSummaries: [],
	});
	t.is(messages[0].role, 'system');
	t.is(messages.length, 2);
});

function fakeClientReturning(content: string): LLMClient {
	return {
		getCurrentModel: () => 'fake',
		setModel: () => {},
		getContextSize: () => 8192,
		getAvailableModels: async () => ['fake'],
		getProviderConfig: () => ({name: 'fake'}),
		chat: async () => ({
			choices: [{message: {role: 'assistant', content}}],
		}),
		clearContext: async () => {},
		getTimeout: () => undefined,
	} as unknown as LLMClient;
}

const ctx = {firstUserMessage: 'fix this', toolSummaries: ['read_file: a.ts']};

test('generateSessionTitle returns a sanitized title', async t => {
	const client = fakeClientReturning('"Fix Login Redirect Bug."');
	t.is(await generateSessionTitle(client, ctx), 'Fix Login Redirect Bug');
});

test('generateSessionTitle returns null when the client throws', async t => {
	const client = {
		...fakeClientReturning(''),
		chat: async () => {
			throw new Error('connection refused');
		},
	} as unknown as LLMClient;
	t.is(await generateSessionTitle(client, ctx), null);
});

test('generateSessionTitle returns null on an empty response', async t => {
	t.is(await generateSessionTitle(fakeClientReturning(''), ctx), null);
	t.is(await generateSessionTitle(fakeClientReturning('   \n '), ctx), null);
});

test('generateSessionTitle returns null when the model writes a paragraph', async t => {
	const paragraph = 'Certainly! '.repeat(30);
	t.is(await generateSessionTitle(fakeClientReturning(paragraph), ctx), null);
});

test('generateSessionTitle returns null when there are no choices', async t => {
	const client = {
		...fakeClientReturning(''),
		chat: async () => ({choices: []}),
	} as unknown as LLMClient;
	t.is(await generateSessionTitle(client, ctx), null);
});

test('generateSessionTitle passes no tools to the client', async t => {
	let seenTools: unknown;
	const client = {
		...fakeClientReturning('Fix Login Bug'),
		chat: async (_messages: unknown, tools: unknown) => {
			seenTools = tools;
			return {
				choices: [{message: {role: 'assistant', content: 'Fix Login Bug'}}],
			};
		},
	} as unknown as LLMClient;
	await generateSessionTitle(client, ctx);
	t.deepEqual(seenTools, {});
});

test('generateSessionTitle forwards the abort signal', async t => {
	let seenSignal: AbortSignal | undefined;
	const client = {
		...fakeClientReturning('Fix Login Bug'),
		chat: async (
			_messages: unknown,
			_tools: unknown,
			_callbacks: unknown,
			signal?: AbortSignal,
		) => {
			seenSignal = signal;
			return {
				choices: [{message: {role: 'assistant', content: 'Fix Login Bug'}}],
			};
		},
	} as unknown as LLMClient;
	const controller = new AbortController();
	await generateSessionTitle(client, ctx, controller.signal);
	t.is(seenSignal, controller.signal);
});
