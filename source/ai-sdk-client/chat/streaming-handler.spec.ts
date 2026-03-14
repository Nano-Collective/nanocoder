import test from 'ava';
import type {StreamCallbacks} from '@/types/index';
import {createOnStepFinishHandler, createPrepareStepHandler} from './streaming-handler.js';
import type {TestableMessage} from '../types.js';

test('createOnStepFinishHandler handles steps with tool calls (logging only)', t => {
	const callbacks: StreamCallbacks = {};

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

	// No error means logging worked fine
	t.pass();
});

test('createOnStepFinishHandler handles steps without tool calls', t => {
	const callbacks: StreamCallbacks = {};

	const handler = createOnStepFinishHandler(callbacks);
	handler({
		text: 'Some text',
	});

	t.pass();
});

test('createOnStepFinishHandler handles steps with tool calls but no results', t => {
	const callbacks: StreamCallbacks = {};

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

test('createPrepareStepHandler filters empty assistant messages', t => {
	const handler = createPrepareStepHandler();
	const messages = [
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: ''},
		{role: 'user', content: 'World'},
	] as unknown as TestableMessage[];

	const result = handler({messages: messages as any});

	t.truthy(result.messages);
	t.is(result.messages?.length, 2);
	t.is((result.messages?.[0] as any).content, 'Hello');
	t.is((result.messages?.[1] as any).content, 'World');
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
	t.is(result.messages?.length, 2);
	t.is((result.messages?.[0] as any).content, 'Hello');
	t.is((result.messages?.[1] as any).content, 'World');
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
	t.is(result.messages?.length, 3);
	t.is(result.messages?.[0].role, 'user');
	t.is(result.messages?.[1].role, 'user');
	t.is(result.messages?.[2].role, 'user');
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
