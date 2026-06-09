import test from 'ava';
import type {Message} from '@/types/core';
import {capMessagesForModel} from './message-capping.js';

test('capMessagesForModel does not slice if history is within limit', t => {
	const messages: Message[] = [
		{role: 'user', content: 'hello'},
		{role: 'assistant', content: 'hi'},
	];
	const capped = capMessagesForModel(messages, 5);
	t.deepEqual(capped, messages);
});

test('capMessagesForModel slices normally when no tool calls are near the boundary', t => {
	const messages: Message[] = [
		{role: 'user', content: 'msg 1'},
		{role: 'assistant', content: 'msg 2'},
		{role: 'user', content: 'msg 3'},
		{role: 'assistant', content: 'msg 4'},
	];
	const capped = capMessagesForModel(messages, 2);
	t.deepEqual(capped, [
		{role: 'user', content: 'msg 3'},
		{role: 'assistant', content: 'msg 4'},
	]);
});

test('capMessagesForModel walks back to avoid orphaned tool results', t => {
	const messages: Message[] = [
		{role: 'user', content: 'run command'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [{id: 'call_1', function: {name: 'bash', arguments: {}}}],
		},
		{role: 'tool', tool_call_id: 'call_1', name: 'bash', content: 'output'},
		{role: 'user', content: 'another command'},
	];

	// Cap at 2 messages. Naively, this would start at index 2: { role: 'tool' ... }.
	// That would start with an orphaned tool result.
	// Our helper must walk back to index 1 to include the assistant message.
	const capped = capMessagesForModel(messages, 2);

	t.deepEqual(capped, [
		{
			role: 'assistant',
			content: '',
			tool_calls: [{id: 'call_1', function: {name: 'bash', arguments: {}}}],
		},
		{role: 'tool', tool_call_id: 'call_1', name: 'bash', content: 'output'},
		{role: 'user', content: 'another command'},
	]);
});

test('capMessagesForModel walks back through multiple tool results', t => {
	const messages: Message[] = [
		{role: 'user', content: 'run parallel tools'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{id: 'call_1', function: {name: 'bash', arguments: {}}},
				{id: 'call_2', function: {name: 'read', arguments: {}}},
			],
		},
		{role: 'tool', tool_call_id: 'call_1', name: 'bash', content: 'out 1'},
		{role: 'tool', tool_call_id: 'call_2', name: 'read', content: 'out 2'},
		{role: 'user', content: 'thanks'},
	];

	// Cap at 2 messages (start at index 3: { role: 'tool', tool_call_id: 'call_2' }).
	// Must walk back to index 1 (the assistant message).
	const capped = capMessagesForModel(messages, 2);

	t.deepEqual(capped, [
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{id: 'call_1', function: {name: 'bash', arguments: {}}},
				{id: 'call_2', function: {name: 'read', arguments: {}}},
			],
		},
		{role: 'tool', tool_call_id: 'call_1', name: 'bash', content: 'out 1'},
		{role: 'tool', tool_call_id: 'call_2', name: 'read', content: 'out 2'},
		{role: 'user', content: 'thanks'},
	]);
});
