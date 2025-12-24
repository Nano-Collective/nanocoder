import test from 'ava';
import type {StreamCallbacks} from '@/types/index';
import {createOnStepFinishHandler, createPrepareStepHandler} from './streaming-handler.js';
import type {TestableMessage} from '../types.js';

test('createOnStepFinishHandler calls onToolExecuted callback', t => {
	let callbackCalled = false;
	const callbacks: StreamCallbacks = {
		onToolExecuted: (toolCall, result) => {
			callbackCalled = true;
			t.is(toolCall.function.name, 'test_tool');
			t.is(result, 'test output');
		},
	};

	const handler = createOnStepFinishHandler(callbacks);
	handler({
		toolCalls: [
			{
				toolCallId: 'call_123',
				toolName: 'test_tool',
				input: {},
			},
		],
		toolResults: [
			{
				output: 'test output',
			},
		],
	});

	t.true(callbackCalled);
});

test('createOnStepFinishHandler handles steps without tool calls', t => {
	const callbacks: StreamCallbacks = {
		onToolExecuted: () => {
			t.fail('Should not be called');
		},
	};

	const handler = createOnStepFinishHandler(callbacks);
	handler({
		text: 'Some text',
	});

	t.pass();
});

test('createOnStepFinishHandler handles steps with tool calls but no results', t => {
	const callbacks: StreamCallbacks = {
		onToolExecuted: () => {
			t.fail('Should not be called');
		},
	};

	const handler = createOnStepFinishHandler(callbacks);
	handler({
		toolCalls: [
			{
				toolCallId: 'call_123',
				toolName: 'test_tool',
				input: {},
			},
		],
	});

	t.pass();
});

test('createOnStepFinishHandler converts object output to JSON string', t => {
	let resultReceived = '';
	const callbacks: StreamCallbacks = {
		onToolExecuted: (_toolCall, result) => {
			resultReceived = result;
		},
	};

	const handler = createOnStepFinishHandler(callbacks);
	handler({
		toolCalls: [
			{
				toolCallId: 'call_123',
				toolName: 'test_tool',
				input: {},
			},
		],
		toolResults: [
			{
				output: {key: 'value'},
			},
		],
	});

	t.is(resultReceived, '{"key":"value"}');
});

test('createPrepareStepHandler filters empty assistant messages', t => {
	const handler = createPrepareStepHandler();
	const messages = [
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: ''},
		{role: 'user', content: 'World'},
	] as unknown as TestableMessage[];

	const result = handler({messages: messages as any});

	t.truthy(result.messages);
	// After filtering empty assistant and merging consecutive user messages, expect 1 message
	t.is(result.messages?.length, 1);
	t.is((result.messages?.[0] as any).role, 'user');
	t.is((result.messages?.[0] as any).content, 'Hello\n\nWorld');
});

test('createPrepareStepHandler filters orphaned tool messages', t => {
	const handler = createPrepareStepHandler();
	const messages = [
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: ''},
		{role: 'tool', content: 'Tool result'},
		{role: 'user', content: 'World'},
	] as unknown as TestableMessage[];

	const result = handler({messages: messages as any});

	t.truthy(result.messages);
	// After filtering empty assistant, orphaned tool, and merging consecutive user messages, expect 1 message
	t.is(result.messages?.length, 1);
	t.is((result.messages?.[0] as any).role, 'user');
	t.is((result.messages?.[0] as any).content, 'Hello\n\nWorld');
});

test('createPrepareStepHandler returns empty object when no filtering needed', t => {
	const handler = createPrepareStepHandler();
	const messages = [
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: 'Hi'},
	] as unknown as TestableMessage[];

	const result = handler({messages: messages as any});

	t.deepEqual(result, {});
});

test('createPrepareStepHandler filters multiple empty assistant messages', t => {
	const handler = createPrepareStepHandler();
	const messages = [
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: ''},
		{role: 'user', content: 'World'},
		{role: 'assistant', content: '   '},
		{role: 'user', content: 'Test'},
	] as unknown as TestableMessage[];

	const result = handler({messages: messages as any});

	t.truthy(result.messages);
	// After filtering empty assistants and merging consecutive user messages, expect 1 merged user message
	t.is(result.messages?.length, 1);
	t.is(result.messages?.[0].role, 'user');
	t.is((result.messages?.[0] as any).content, 'Hello\n\nWorld\n\nTest');
});

test('createPrepareStepHandler keeps non-empty assistant messages', t => {
	const handler = createPrepareStepHandler();
	const messages = [
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: 'Response'},
		{role: 'user', content: 'World'},
	] as unknown as TestableMessage[];

	const result = handler({messages: messages as any});

	t.deepEqual(result, {});
});
