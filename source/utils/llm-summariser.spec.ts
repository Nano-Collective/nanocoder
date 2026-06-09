import test from 'ava';
import type {LLMChatResponse, LLMClient, Message} from '@/types/core';
import type {Tokenizer} from '@/types/tokenization';
import {summariseWithLLM} from './llm-summariser';

function makeTokenizer(): Tokenizer {
	return {
		encode: (text: string) => Math.ceil(text.length / 4),
		countTokens: (msg: Message) =>
			Math.ceil(((msg.content || '') + (msg.role || '')).length / 4),
		getName: () => 'fake',
	};
}

function makeClient(
	respond: (messages: Message[]) => string | Promise<string>,
): LLMClient & {calls: Message[][]} {
	const calls: Message[][] = [];
	const client = {
		calls,
		getCurrentModel: () => 'fake-model',
		setModel: () => {},
		getContextSize: () => 100_000,
		getAvailableModels: async () => ['fake-model'],
		getProviderConfig: () => ({
			name: 'fake',
			type: 'openai' as const,
			models: ['fake-model'],
			config: {},
		}),
		chat: async (messages: Message[]): Promise<LLMChatResponse> => {
			calls.push(messages);
			const content = await respond(messages);
			return {
				choices: [{message: {role: 'assistant' as const, content}}],
			};
		},
		clearContext: async () => {},
		getTimeout: () => undefined,
	};
	return client;
}

const systemMessage: Message = {
	role: 'system',
	content: 'You are a coding agent.',
};

test('summariseWithLLM returns [summary, ...recent] when segment is non-empty', async t => {
	const tokenizer = makeTokenizer();
	const client = makeClient(
		() =>
			'## Context\nWorking on auth refactor.\n## Decisions\n- Use Zod for validation',
	);

	const messages: Message[] = [
		{role: 'user', content: 'a'.repeat(2000)},
		{role: 'assistant', content: 'b'.repeat(2000)},
		{role: 'user', content: 'c'.repeat(2000)},
		{role: 'assistant', content: 'd'.repeat(2000)},
		{role: 'user', content: 'most recent user'},
		{role: 'assistant', content: 'most recent assistant'},
	];

	const result = await summariseWithLLM({
		messages,
		systemMessage,
		client,
		tokenizer,
	});

	t.truthy(result);
	t.is(result!.length, 3, 'summary + 2 recent messages');
	t.is(result![0].role, 'user');
	t.regex(result![0].content || '', /<conversation-summary>/);
	t.regex(result![0].content || '', /Working on auth refactor/);
	t.is(result![1].content, 'most recent user');
	t.is(result![2].content, 'most recent assistant');
	t.is(client.calls.length, 1);
});

test('summariseWithLLM returns null when nothing to compress', async t => {
	const tokenizer = makeTokenizer();
	const client = makeClient(() => 'should not be called');

	const messages: Message[] = [
		{role: 'user', content: 'only one'},
		{role: 'assistant', content: 'and recent'},
	];

	const result = await summariseWithLLM({
		messages,
		systemMessage,
		client,
		tokenizer,
	});

	t.is(result, null);
	t.is(client.calls.length, 0, 'no LLM call when segment is empty');
});

test('summariseWithLLM returns null when LLM throws (so caller falls back)', async t => {
	const tokenizer = makeTokenizer();
	const client = makeClient(() => {
		throw new Error('network down');
	});

	const messages: Message[] = [
		{role: 'user', content: 'a'.repeat(2000)},
		{role: 'assistant', content: 'b'.repeat(2000)},
		{role: 'user', content: 'c'.repeat(2000)},
		{role: 'assistant', content: 'd'.repeat(2000)},
		{role: 'user', content: 'recent'},
		{role: 'assistant', content: 'recent'},
	];

	const result = await summariseWithLLM({
		messages,
		systemMessage,
		client,
		tokenizer,
	});

	t.is(result, null);
});

test('summariseWithLLM returns null when summary is empty', async t => {
	const tokenizer = makeTokenizer();
	const client = makeClient(() => '   ');

	const messages: Message[] = [
		{role: 'user', content: 'a'.repeat(2000)},
		{role: 'assistant', content: 'b'.repeat(2000)},
		{role: 'user', content: 'recent'},
		{role: 'assistant', content: 'recent'},
	];

	const result = await summariseWithLLM({
		messages,
		systemMessage,
		client,
		tokenizer,
	});

	t.is(result, null);
});

test('summariseWithLLM returns null when summary is not smaller than original', async t => {
	const tokenizer = makeTokenizer();
	// Force the LLM to "summarise" by emitting more text than the original
	const client = makeClient(() => 'x'.repeat(20_000));

	const messages: Message[] = [
		{role: 'user', content: 'short'},
		{role: 'assistant', content: 'short'},
		{role: 'user', content: 'recent'},
		{role: 'assistant', content: 'recent'},
	];

	const result = await summariseWithLLM({
		messages,
		systemMessage,
		client,
		tokenizer,
	});

	t.is(result, null, 'caller falls back to mechanical when LLM is unhelpful');
});

test('summariseWithLLM passes a transcript that preserves tool calls and names', async t => {
	const tokenizer = makeTokenizer();
	let lastUserPrompt = '';
	const client = makeClient(messages => {
		const userMsg = messages.find(m => m.role === 'user');
		lastUserPrompt = userMsg?.content || '';
		return '## Context\nok';
	});

	const messages: Message[] = [
		{role: 'user', content: 'please run tests'},
		{
			role: 'assistant',
			content: 'running',
			tool_calls: [
				{
					id: 'call_1',
					type: 'function',
					function: {name: 'execute_bash', arguments: '{"cmd":"pnpm test"}'},
				},
			],
		},
		{role: 'tool', name: 'execute_bash', content: 'all 42 tests passed'},
		{role: 'user', content: 'great, now build'},
		{role: 'assistant', content: 'building'},
	];

	await summariseWithLLM({
		messages,
		systemMessage,
		client,
		tokenizer,
		keepRecentMessages: 2,
	});

	t.regex(lastUserPrompt, /execute_bash/);
	t.regex(lastUserPrompt, /all 42 tests passed/);
	t.regex(lastUserPrompt, /please run tests/);
});

test('summariseWithLLM never starts the recent tail with an orphaned tool result', async t => {
	const tokenizer = makeTokenizer();
	const client = makeClient(() => '## Context\nok');

	// A multi-tool-call assistant turn produces 1 assistant + 2 tool messages.
	// With keepRecentMessages=2 the naive last-2 slice would keep [tool, tool]
	// and summarise the owning assistant away, orphaning both results. Leading
	// filler keeps the compressible segment large enough to beat the
	// summary-not-smaller-than-original guard.
	const messages: Message[] = [
		{role: 'user', content: 'a'.repeat(2000)},
		{role: 'assistant', content: 'b'.repeat(2000)},
		{role: 'user', content: 'do the thing'},
		{
			role: 'assistant',
			content: 'working',
			tool_calls: [
				{id: 'call_A', type: 'function', function: {name: 'edit', arguments: '{}'}},
				{id: 'call_B', type: 'function', function: {name: 'read', arguments: '{}'}},
			],
		},
		{role: 'tool', name: 'edit', tool_call_id: 'call_A', content: 'edited'},
		{role: 'tool', name: 'read', tool_call_id: 'call_B', content: 'contents'},
	];

	const result = await summariseWithLLM({
		messages,
		systemMessage,
		client,
		tokenizer,
		keepRecentMessages: 2,
	});

	t.truthy(result);
	// The boundary is walked back to include the owning assistant, so the tail
	// is [assistant(tool_calls), tool, tool] — never a tool with no parent.
	t.is(result![0].role, 'user', 'first message is the summary');
	t.not(
		result![1].role,
		'tool',
		'recent tail must not begin with an orphaned tool result',
	);
	const firstTool = result!.findIndex(m => m.role === 'tool');
	const owningAssistant = result!.findIndex(
		m => m.role === 'assistant' && m.tool_calls?.length,
	);
	t.true(
		owningAssistant !== -1 && owningAssistant < firstTool,
		'every kept tool result is preceded by its owning assistant(tool_calls)',
	);
});
