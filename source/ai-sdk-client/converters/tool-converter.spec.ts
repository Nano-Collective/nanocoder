import test from 'ava';
import {generateToolCallId} from '@/utils/tool-call-id';
import {
	convertAISDKToolCall,
	convertAISDKToolCalls,
	getToolResultOutput,
} from './tool-converter.js';

test('generateToolCallId creates unique IDs', t => {
	const id1 = generateToolCallId();
	const id2 = generateToolCallId();

	t.true(id1.startsWith('tool_'));
	t.true(id2.startsWith('tool_'));
	t.not(id1, id2);
});

test('convertAISDKToolCall uses provided toolCallId', t => {
	const aiToolCall = {
		toolCallId: 'call_123',
		toolName: 'test_tool',
		input: {arg: 'value'},
	};

	const result = convertAISDKToolCall(aiToolCall);

	t.is(result.id, 'call_123');
	t.is(result.function.name, 'test_tool');
	t.deepEqual(result.function.arguments, {arg: 'value'});
});

test('convertAISDKToolCall generates ID when missing', t => {
	const aiToolCall = {
		toolName: 'test_tool',
		input: {arg: 'value'},
	};

	const result = convertAISDKToolCall(aiToolCall);

	t.true(result.id.startsWith('tool_'));
	t.is(result.function.name, 'test_tool');
	t.deepEqual(result.function.arguments, {arg: 'value'});
});

test('convertAISDKToolCalls converts multiple tool calls', t => {
	const aiToolCalls = [
		{
			toolCallId: 'call_1',
			toolName: 'tool_1',
			input: {a: 1},
		},
		{
			toolName: 'tool_2',
			input: {b: 2},
		},
	];

	const result = convertAISDKToolCalls(aiToolCalls);

	t.is(result.length, 2);
	t.is(result[0].id, 'call_1');
	t.is(result[0].function.name, 'tool_1');
	t.true(result[1].id.startsWith('tool_'));
	t.is(result[1].function.name, 'tool_2');
});

test('convertAISDKToolCalls handles empty array', t => {
	const result = convertAISDKToolCalls([]);
	t.deepEqual(result, []);
});

test('getToolResultOutput returns string as-is', t => {
	const result = getToolResultOutput('test output');
	t.is(result, 'test output');
});

test('getToolResultOutput converts object to JSON string', t => {
	const result = getToolResultOutput({key: 'value'});
	t.is(result, '{"key":"value"}');
});

test('getToolResultOutput converts array to JSON string', t => {
	const result = getToolResultOutput([1, 2, 3]);
	t.is(result, '[1,2,3]');
});

test('getToolResultOutput converts number to JSON string', t => {
	const result = getToolResultOutput(42);
	t.is(result, '42');
});
