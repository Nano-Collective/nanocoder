import test from 'ava';
import type {Message} from '@/types/core';
import {sanitizeMessageList, validateMessageList} from './message-sanitizer';

/**
 * Test suite for message sanitization and validation.
 * Ensures messages meet API requirements before sending to LLM.
 */

// Helper to create test messages
const createUserMessage = (content: string): Message => ({
	role: 'user',
	content,
});

const createAssistantMessage = (content: string): Message => ({
	role: 'assistant',
	content,
});

const createAssistantMessageWithTools = (
	content: string,
	toolNames: string[],
): Message => ({
	role: 'assistant',
	content,
	tool_calls: toolNames.map((name, i) => ({
		id: `call_${i}`,
		function: {
			name,
			arguments: {},
		},
	})),
});

const createToolResultMessage = (toolName: string, result: string): Message => ({
	role: 'tool',
	content: result,
	tool_call_id: 'call_0',
	name: toolName,
});

const createSystemMessage = (content: string): Message => ({
	role: 'system',
	content,
});

test('sanitizeMessageList - returns all messages when within budget', t => {
	const messages: Message[] = [
		createSystemMessage('You are a helpful assistant'),
		createUserMessage('Hello'),
		createAssistantMessage('Hi there!'),
		createUserMessage('How are you?'),
		createAssistantMessage('I am doing well'),
	];

	const result = sanitizeMessageList(messages);

	t.is(result.messages.length, 5);
	t.false(result.sanitized);
	t.is(result.combinedAssistantMessages, 0);
});

test('sanitizeMessageList - combines two consecutive assistant messages', t => {
	const messages: Message[] = [
		createUserMessage('Hello'),
		createAssistantMessage('First response'),
		createAssistantMessage('Second response'),
	];

	const result = sanitizeMessageList(messages);

	t.is(result.messages.length, 2);
	t.true(result.sanitized);
	t.is(result.combinedAssistantMessages, 1);
	
	// Check combined message
	const combined = result.messages[1];
	t.is(combined.role, 'assistant');
	t.true(combined.content.includes('First response'));
	t.true(combined.content.includes('Second response'));
});

test('sanitizeMessageList - combines three consecutive assistant messages', t => {
	const messages: Message[] = [
		createUserMessage('Hello'),
		createAssistantMessage('Response 1'),
		createAssistantMessage('Response 2'),
		createAssistantMessage('Response 3'),
	];

	const result = sanitizeMessageList(messages);

	t.is(result.messages.length, 2);
	t.is(result.combinedAssistantMessages, 2);
	
	const combined = result.messages[1];
	t.is(combined.role, 'assistant');
	t.true(combined.content.includes('Response 1'));
	t.true(combined.content.includes('Response 2'));
	t.true(combined.content.includes('Response 3'));
});

test('sanitizeMessageList - preserves tool calls when combining', t => {
	const messages: Message[] = [
		createUserMessage('Hello'),
		createAssistantMessageWithTools('I will read a file', ['read_file']),
		createAssistantMessageWithTools('I will also write', ['write_file']),
	];

	const result = sanitizeMessageList(messages);

	t.is(result.messages.length, 2);
	const combined = result.messages[1];
	t.truthy(combined.tool_calls);
	t.is(combined.tool_calls?.length, 2);
	t.is(combined.tool_calls?.[0].function.name, 'read_file');
	t.is(combined.tool_calls?.[1].function.name, 'write_file');
});

test('sanitizeMessageList - handles empty message list', t => {
	const messages: Message[] = [];

	const result = sanitizeMessageList(messages);

	t.is(result.messages.length, 0);
	t.false(result.sanitized);
	t.is(result.combinedAssistantMessages, 0);
});

test('sanitizeMessageList - handles single message', t => {
	const messages: Message[] = [createUserMessage('Hello')];

	const result = sanitizeMessageList(messages);

	t.is(result.messages.length, 1);
	t.false(result.sanitized);
	t.is(result.combinedAssistantMessages, 0);
});

test('sanitizeMessageList - handles trailing tool messages correctly', t => {
	const messages: Message[] = [
		createAssistantMessageWithTools('I will read file', ['read_file']),
		createToolResultMessage('read_file', 'file content'),
		createAssistantMessage('Analysis'),
	];

	const result = sanitizeMessageList(messages);

	t.is(result.messages.length, 3);
	t.false(result.sanitized);
	t.is(result.combinedAssistantMessages, 0);
});

test('sanitizeMessageList - combines consecutive assistants with tools and results', t => {
	const messages: Message[] = [
		createUserMessage('Start'),
		createAssistantMessageWithTools('First step', ['read_file']),
		createToolResultMessage('read_file', 'content'),
		createAssistantMessage('Second step'),
		createAssistantMessage('Third step'),
	];

	const result = sanitizeMessageList(messages);

	// Should combine the two trailing assistant messages
	t.is(result.messages.length, 4);
	t.is(result.combinedAssistantMessages, 1);
	
	const combined = result.messages[3];
	t.is(combined.role, 'assistant');
	t.true(combined.content.includes('Second step'));
	t.true(combined.content.includes('Third step'));
});

test('validateMessageList - accepts valid message sequences', t => {
	const validSequences = [
		[createUserMessage('Hi')],
		[createSystemMessage('System'), createUserMessage('Hi')],
		[
			createUserMessage('Hi'),
			createAssistantMessage('Hi there'),
		],
		[
			createUserMessage('Hi'),
			createAssistantMessageWithTools('Reading', ['read_file']),
			createToolResultMessage('read_file', 'result'),
		],
		[
			createUserMessage('Hi'),
			createAssistantMessageWithTools('Reading', ['read_file']),
			createToolResultMessage('read_file', 'result'),
			createAssistantMessage('Done'),
		],
	];

	for (const sequence of validSequences) {
		t.true(validateMessageList(sequence), `Failed for: ${sequence.map(m => m.role).join(' -> ')}`);
	}
});

test('validateMessageList - rejects multiple trailing assistant messages', t => {
	const invalidSequence: Message[] = [
		createUserMessage('Hi'),
		createAssistantMessage('Response 1'),
		createAssistantMessage('Response 2'),
	];

	t.false(validateMessageList(invalidSequence));
});

test('validateMessageList - rejects tool message without preceding assistant', t => {
	const invalidSequence: Message[] = [
		createUserMessage('Hi'),
		createToolResultMessage('read_file', 'content'),
	];

	t.false(validateMessageList(invalidSequence));
});

test('validateMessageList - accepts empty list', t => {
	t.true(validateMessageList([]));
});

test('sanitizeMessageList - handles multiple consecutive assistant groups', t => {
	const messages: Message[] = [
		createUserMessage('Step 1'),
		createAssistantMessage('A1'),
		createAssistantMessage('A2'),
		createUserMessage('Step 2'),
		createAssistantMessage('B1'),
		createAssistantMessage('B2'),
	];

	const result = sanitizeMessageList(messages);

	// Both groups should be combined
	t.is(result.messages.length, 4);
	t.is(result.combinedAssistantMessages, 2);

	// Check first combined group
	t.is(result.messages[1].role, 'assistant');
	t.true(result.messages[1].content.includes('A1'));
	t.true(result.messages[1].content.includes('A2'));

	// Check second combined group
	t.is(result.messages[3].role, 'assistant');
	t.true(result.messages[3].content.includes('B1'));
	t.true(result.messages[3].content.includes('B2'));
});

test('sanitizeMessageList - preserves message order', t => {
	const messages: Message[] = [
		createSystemMessage('System'),
		createUserMessage('User 1'),
		createAssistantMessage('Assistant 1'),
		createAssistantMessage('Assistant 2'),
		createUserMessage('User 2'),
		createAssistantMessage('Assistant 3'),
	];

	const result = sanitizeMessageList(messages);

	t.is(result.messages[0].role, 'system');
	t.is(result.messages[1].role, 'user');
	t.is(result.messages[2].role, 'assistant');
	t.is(result.messages[3].role, 'user');
	t.is(result.messages[4].role, 'assistant');
});

test('sanitizeMessageList - includes tool names in summary', t => {
	const messages: Message[] = [
		createUserMessage('Hello'),
		createAssistantMessageWithTools('Running tools', ['read_file', 'write_file']),
		createAssistantMessage('Done'),
	];

	const result = sanitizeMessageList(messages);

	const combined = result.messages[1];
	t.true(combined.content.includes('Tools called'));
	t.true(combined.content.includes('read_file'));
	t.true(combined.content.includes('write_file'));
});

test('sanitizeMessageList - handles assistant message with empty content', t => {
	const messages: Message[] = [
		createUserMessage('Hello'),
		{role: 'assistant', content: ''} as Message,
		createAssistantMessage('Response'),
	];

	const result = sanitizeMessageList(messages);

	t.is(result.messages.length, 2);
	t.is(result.combinedAssistantMessages, 1);
});
