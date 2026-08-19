import type {ModelMessage} from 'ai';
import test from 'ava';
import {MAX_TOOL_RESULT_CHARS} from '@/constants';
import type {Message} from '@/types/index';
import {
	convertToModelMessages,
	dropOrphanedToolResults,
	isEmptyAssistantMessage,
	withCacheBreakpoints,
} from './message-converter.js';
import type {TestableMessage} from '../types.js';

test('isEmptyAssistantMessage returns false for non-assistant messages', t => {
	const message: TestableMessage = {
		role: 'user',
		content: '',
	};
	t.false(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage returns true for empty assistant message with string content', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: '',
	};
	t.true(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage returns true for empty assistant message with whitespace', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: '   ',
	};
	t.true(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage returns true for empty assistant message with empty array content', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: [],
	};
	t.true(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage returns false for assistant message with content', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: 'Hello',
	};
	t.false(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage returns false for assistant message with tool calls', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: '',
		toolCalls: [{name: 'test', arguments: {}}],
	};
	t.false(isEmptyAssistantMessage(message));
});

test('convertToModelMessages converts system message', t => {
	const messages: Message[] = [
		{
			role: 'system',
			content: 'You are a helpful assistant',
		},
	];

	const result = convertToModelMessages(messages);
	t.is(result.length, 1);
	t.is(result[0].role, 'system');
	t.is(result[0].content, 'You are a helpful assistant');
});

test('convertToModelMessages converts user message', t => {
	const messages: Message[] = [
		{
			role: 'user',
			content: 'Hello',
		},
	];

	const result = convertToModelMessages(messages);
	t.is(result.length, 1);
	t.is(result[0].role, 'user');
	t.is(result[0].content, 'Hello');
});

test('convertToModelMessages emits image parts for a user message with attachments', t => {
	const messages: Message[] = [
		{
			role: 'user',
			content: 'what is in this screenshot?',
			images: [{data: 'BASE64DATA', mediaType: 'image/png'}],
		},
	];

	const result = convertToModelMessages(messages);
	t.is(result.length, 1);
	t.is(result[0].role, 'user');
	const content = result[0].content as Array<Record<string, unknown>>;
	t.true(Array.isArray(content));
	t.is(content[0].type, 'text');
	t.is(content[0].text, 'what is in this screenshot?');
	t.is(content[1].type, 'image');
	t.is(content[1].image, 'data:image/png;base64,BASE64DATA');
	t.is(content[1].mediaType, 'image/png');
});

test('convertToModelMessages keeps image-only user messages without a text part', t => {
	const messages: Message[] = [
		{
			role: 'user',
			content: '',
			images: [{data: 'IMG', mediaType: 'image/jpeg'}],
		},
	];

	const result = convertToModelMessages(messages);
	const content = result[0].content as Array<Record<string, unknown>>;
	t.is(content.length, 1);
	t.is(content[0].type, 'image');
});

test('convertToModelMessages leaves text-only user messages as plain strings', t => {
	const messages: Message[] = [{role: 'user', content: 'plain text'}];
	const result = convertToModelMessages(messages);
	t.is(result[0].content, 'plain text');
});

test('convertToModelMessages converts assistant message with text', t => {
	const messages: Message[] = [
		{
			role: 'assistant',
			content: 'Hi there',
		},
	];

	const result = convertToModelMessages(messages);
	t.is(result.length, 1);
	t.is(result[0].role, 'assistant');
	t.true(Array.isArray(result[0].content));
	const content = result[0].content as Array<{type: string; text?: string}>;
	t.is(content.length, 1);
	t.is(content[0].type, 'text');
	t.is(content[0].text, 'Hi there');
});

test('convertToModelMessages converts assistant message with tool calls', t => {
	const messages: Message[] = [
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_123',
					function: {
						name: 'test_tool',
						arguments: {arg: 'value'},
					},
				},
			],
		},
	];

	const result = convertToModelMessages(messages);
	t.is(result.length, 1);
	t.is(result[0].role, 'assistant');
	t.true(Array.isArray(result[0].content));
	const content = result[0].content as Array<{
		type: string;
		toolCallId?: string;
		toolName?: string;
		input?: unknown;
	}>;
	t.is(content.length, 1);
	t.is(content[0].type, 'tool-call');
	t.is(content[0].toolCallId, 'call_123');
	t.is(content[0].toolName, 'test_tool');
	t.deepEqual(content[0].input, {arg: 'value'});
});

test('convertToModelMessages converts assistant message with both text and tool calls', t => {
	const messages: Message[] = [
		{
			role: 'assistant',
			content: 'Let me help',
			tool_calls: [
				{
					id: 'call_123',
					function: {
						name: 'test_tool',
						arguments: {},
					},
				},
			],
		},
	];

	const result = convertToModelMessages(messages);
	t.is(result.length, 1);
	t.is(result[0].role, 'assistant');
	t.true(Array.isArray(result[0].content));
	const content = result[0].content as Array<{type: string}>;
	t.is(content.length, 2);
	t.is(content[0].type, 'text');
	t.is(content[1].type, 'tool-call');
});

test('convertToModelMessages converts empty assistant message to message with empty text', t => {
	const messages: Message[] = [
		{
			role: 'assistant',
			content: '',
		},
	];

	const result = convertToModelMessages(messages);
	t.is(result.length, 1);
	t.is(result[0].role, 'assistant');
	t.true(Array.isArray(result[0].content));
	const content = result[0].content as Array<{type: string; text?: string}>;
	t.is(content.length, 1);
	t.is(content[0].type, 'text');
	t.is(content[0].text, '');
});

test('convertToModelMessages converts tool message', t => {
	const messages: Message[] = [
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{id: 'call_123', function: {name: 'test_tool', arguments: {}}},
			],
		},
		{
			role: 'tool',
			content: 'Tool result',
			tool_call_id: 'call_123',
			name: 'test_tool',
		},
	];

	const result = convertToModelMessages(messages);
	t.is(result.length, 2);
	const toolMsg = result[1];
	t.is(toolMsg.role, 'tool');
	t.true(Array.isArray(toolMsg.content));
	const content = toolMsg.content as Array<{
		type: string;
		toolCallId?: string;
		toolName?: string;
		output?: {type: string; value: string};
	}>;
	t.is(content.length, 1);
	t.is(content[0].type, 'tool-result');
	t.is(content[0].toolCallId, 'call_123');
	t.is(content[0].toolName, 'test_tool');
	t.is(content[0].output?.type, 'text');
	t.is(content[0].output?.value, 'Tool result');
});

test('convertToModelMessages emits a json output for structured tool results', t => {
	const messages: Message[] = [
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{id: 'call_456', function: {name: 'lsp_get_diagnostics', arguments: {}}},
			],
		},
		{
			role: 'tool',
			content: 'Diagnostics for x.ts: 1 error',
			tool_call_id: 'call_456',
			name: 'lsp_get_diagnostics',
			structuredContent: {diagnostics: [{file: 'x.ts', severity: 'error'}]},
		},
	];

	const result = convertToModelMessages(messages);
	const content = result[1].content as Array<{
		output?: {type: string; value: unknown};
	}>;
	t.is(content[0].output?.type, 'json');
	t.deepEqual(content[0].output?.value, {
		diagnostics: [{file: 'x.ts', severity: 'error'}],
	});
});

test('convertToModelMessages caps oversized structured tool results', t => {
	const messages: Message[] = [
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{id: 'call_oversized', function: {name: 'large_tool', arguments: {}}},
			],
		},
		{
			role: 'tool',
			content: 'bounded fallback',
			tool_call_id: 'call_oversized',
			name: 'large_tool',
			structuredContent: {
				head: 'HEAD',
				middle: 'x'.repeat(MAX_TOOL_RESULT_CHARS),
				tail: 'TAIL',
			},
		},
	];

	const result = convertToModelMessages(messages);
	const content = result[1].content as Array<{
		output?: {type: string; value: unknown};
	}>;
	const output = content[0].output;

	t.is(output?.type, 'text');
	t.is(typeof output?.value, 'string');
	const value = output?.value as string;
	t.is(value.length, MAX_TOOL_RESULT_CHARS);
	t.true(value.startsWith('{"head":"HEAD"'));
	t.true(value.endsWith('"tail":"TAIL"}'));
	t.true(value.includes('Output truncated'));
});

test('convertToModelMessages handles multiple messages', t => {
	const messages: Message[] = [
		{role: 'system', content: 'System'},
		{role: 'user', content: 'User'},
		{role: 'assistant', content: 'Assistant'},
	];

	const result = convertToModelMessages(messages);
	t.is(result.length, 3);
	t.is(result[0].role, 'system');
	t.is(result[1].role, 'user');
	t.is(result[2].role, 'assistant');
});

test('convertToModelMessages handles unknown role with fallback', t => {
	const messages: Message[] = [
		{
			role: 'unknown' as any, // Invalid role not in expected set
			content: 'Test content',
		},
	];

	const result = convertToModelMessages(messages);
	t.is(result.length, 1);
	// Should fall back to user role
	t.is(result[0].role, 'user');
	t.is(result[0].content, 'Test content');
});

test('dropOrphanedToolResults removes a tool result with no preceding tool_call', t => {
	// This is the shape a broken compaction produces: a summary user message
	// immediately followed by a tool result whose owning assistant was dropped.
	const messages: Message[] = [
		{role: 'user', content: '<conversation-summary>...</conversation-summary>'},
		{role: 'tool', content: 'orphan', tool_call_id: 'call_gone', name: 'edit'},
		{role: 'user', content: 'Continue'},
	];

	const result = dropOrphanedToolResults(messages);
	t.is(result.length, 2);
	t.false(
		result.some(m => m.role === 'tool'),
		'orphaned tool result is dropped',
	);
	t.is(result[0].role, 'user');
	t.is(result[1].content, 'Continue');
});

test('dropOrphanedToolResults keeps a tool result paired with its assistant', t => {
	const messages: Message[] = [
		{
			role: 'assistant',
			content: '',
			tool_calls: [{id: 'call_1', function: {name: 'edit', arguments: {}}}],
		},
		{role: 'tool', content: 'edited', tool_call_id: 'call_1', name: 'edit'},
	];

	const result = dropOrphanedToolResults(messages);
	t.is(result.length, 2);
	t.is(result[1].role, 'tool');
});

test('dropOrphanedToolResults drops a tool result lacking a tool_call_id', t => {
	const messages: Message[] = [
		{role: 'user', content: 'hi'},
		{role: 'tool', content: 'no id', name: 'edit'},
	];

	const result = dropOrphanedToolResults(messages);
	t.is(result.length, 1);
	t.is(result[0].role, 'user');
});

const BIG = 'S'.repeat(5000);
const BREAKPOINT = {anthropic: {cacheControl: {type: 'ephemeral'}}};

test('withCacheBreakpoints folds the system prompt in as the first message', t => {
	const result = withCacheBreakpoints(
		[{role: 'user', content: 'hi'}],
		'system text',
	);
	t.is(result.length, 2);
	t.is(result[0]?.role, 'system');
	t.is(result[0]?.content, 'system text');
});

test('withCacheBreakpoints marks the system prompt and the last message', t => {
	const result = withCacheBreakpoints(
		[
			{role: 'user', content: BIG},
			{role: 'assistant', content: 'a'},
			{role: 'user', content: 'b'},
		],
		'system text',
	);
	t.deepEqual(result[0]?.providerOptions, BREAKPOINT);
	t.is(result[1]?.providerOptions, undefined);
	t.is(result[2]?.providerOptions, undefined);
	t.deepEqual(result[3]?.providerOptions, BREAKPOINT);
});

test('withCacheBreakpoints emits at most two breakpoints', t => {
	const messages = Array.from({length: 12}, (_, i) => ({
		role: 'user' as const,
		content: `${BIG}${i}`,
	}));
	const marked = withCacheBreakpoints(messages, BIG).filter(
		m => m.providerOptions !== undefined,
	);
	t.is(marked.length, 2);
});

test('withCacheBreakpoints skips breakpoints below the cacheable minimum', t => {
	const result = withCacheBreakpoints(
		[{role: 'user', content: 'hi'}],
		'short system',
	);
	t.is(result.length, 2);
	t.is(result[0]?.providerOptions, undefined);
	t.is(result[1]?.providerOptions, undefined);
});

test('withCacheBreakpoints marks only the last message when there is no system prompt', t => {
	const result = withCacheBreakpoints(
		[
			{role: 'user', content: BIG},
			{role: 'assistant', content: 'tail'},
		],
		'',
	);
	t.is(result.length, 2);
	t.is(result[0]?.providerOptions, undefined);
	t.deepEqual(result[1]?.providerOptions, BREAKPOINT);
});

test('withCacheBreakpoints marks only the system prompt when there are no messages', t => {
	const result = withCacheBreakpoints([], BIG);
	t.is(result.length, 1);
	t.deepEqual(result[0]?.providerOptions, BREAKPOINT);
});

test('withCacheBreakpoints returns an empty array for empty input', t => {
	t.deepEqual(withCacheBreakpoints([], ''), []);
});

test('withCacheBreakpoints counts array content toward the threshold', t => {
	const result = withCacheBreakpoints(
		[
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: '1',
						toolName: 'read_file',
						output: {type: 'text', value: BIG},
					},
				],
			},
		],
		'',
	);
	t.deepEqual(result[0]?.providerOptions, BREAKPOINT);
});

test('withCacheBreakpoints does not mutate its inputs', t => {
	const messages: ModelMessage[] = [
		{role: 'user', content: BIG},
		{role: 'assistant', content: 'tail'},
	];
	withCacheBreakpoints(messages, BIG);
	t.is(messages.length, 2);
	t.is(messages[0]?.providerOptions, undefined);
	t.is(messages[1]?.providerOptions, undefined);
});
