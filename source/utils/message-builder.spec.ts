import test from 'ava';
import {MessageBuilder} from './message-builder.js';
import type {Message, ToolResult} from '@/types/core';

test('MessageBuilder starts with initial messages', t => {
	const userMsg: Message = {role: 'user', content: 'Hello'};
	const builder = new MessageBuilder([userMsg]);

	const messages = builder.build();

	t.is(messages.length, 1);
	t.deepEqual(messages[0], userMsg);
});

test('MessageBuilder addAssistantMessage adds assistant message', t => {
	const builder = new MessageBuilder([]);
	const assistantMsg: Message = {
		role: 'assistant',
		content: 'Hi there',
	};

	builder.addAssistantMessage(assistantMsg);
	const messages = builder.build();

	t.is(messages.length, 1);
	t.is(messages[0].role, 'assistant');
	t.is(messages[0].content, 'Hi there');
});

test('MessageBuilder addAssistantMessage throws on non-assistant message', t => {
	const builder = new MessageBuilder([]);
	const userMsg: Message = {role: 'user', content: 'Test'};

	t.throws(
		() => {
			builder.addAssistantMessage(userMsg);
		},
		{message: /requires a message with role "assistant"/},
	);
});

test('MessageBuilder addToolResults adds tool messages', t => {
	const builder = new MessageBuilder([]);
	const toolResults: ToolResult[] = [
		{
			tool_call_id: 'tool_1',
			role: 'tool',
			name: 'read_file',
			content: 'File contents here',
		},
		{
			tool_call_id: 'tool_2',
			role: 'tool',
			name: 'execute_bash',
			content: 'Command output',
		},
	];

	builder.addToolResults(toolResults);
	const messages = builder.build();

	t.is(messages.length, 2);
	t.is(messages[0].role, 'tool');
	t.is(messages[0].tool_call_id, 'tool_1');
	t.is(messages[0].name, 'read_file');
	t.is(messages[0].content, 'File contents here');

	t.is(messages[1].role, 'tool');
	t.is(messages[1].tool_call_id, 'tool_2');
});

test('MessageBuilder addUserMessage adds user message', t => {
	const builder = new MessageBuilder([]);

	builder.addUserMessage('Hello');
	const messages = builder.build();

	t.is(messages.length, 1);
	t.is(messages[0].role, 'user');
	t.is(messages[0].content, 'Hello');
});

test('MessageBuilder addErrorMessage adds error as user message', t => {
	const builder = new MessageBuilder([]);

	builder.addErrorMessage('Error: something went wrong');
	const messages = builder.build();

	t.is(messages.length, 1);
	t.is(messages[0].role, 'user');
	t.is(messages[0].content, 'Error: something went wrong');
});

test('MessageBuilder supports method chaining', t => {
	const builder = new MessageBuilder([]);

	const messages = builder
		.addUserMessage('Hello')
		.addAssistantMessage({role: 'assistant', content: 'Hi'})
		.addUserMessage('How are you?')
		.build();

	t.is(messages.length, 3);
	t.is(messages[0].role, 'user');
	t.is(messages[1].role, 'assistant');
	t.is(messages[2].role, 'user');
});

test('MessageBuilder length property returns correct count', t => {
	const builder = new MessageBuilder([]);

	t.is(builder.length, 0);

	builder.addUserMessage('Test');
	t.is(builder.length, 1);

	builder.addAssistantMessage({role: 'assistant', content: 'Response'});
	t.is(builder.length, 2);
});

test('MessageBuilder isEmpty property works correctly', t => {
	const builder = new MessageBuilder([]);

	t.true(builder.isEmpty);

	builder.addUserMessage('Test');
	t.false(builder.isEmpty);
});

test('MessageBuilder builds complete conversation flow', t => {
	const userMsg: Message = {role: 'user', content: 'Read config.json'};
	const assistantMsg: Message = {
		role: 'assistant',
		content: '',
		tool_calls: [
			{
				id: 'call_1',
				function: {
					name: 'read_file',
					arguments: {path: 'config.json'},
				},
			},
		],
	};
	const toolResult: ToolResult = {
		tool_call_id: 'call_1',
		role: 'tool',
		name: 'read_file',
		content: '{"setting": "value"}',
	};

	const builder = new MessageBuilder([userMsg]);
	const messages = builder
		.addAssistantMessage(assistantMsg)
		.addToolResults([toolResult])
		.build();

	t.is(messages.length, 3);
	t.is(messages[0].role, 'user');
	t.is(messages[1].role, 'assistant');
	t.is(messages[1].tool_calls?.length, 1);
	t.is(messages[2].role, 'tool');
	t.is(messages[2].content, '{"setting": "value"}');
});
