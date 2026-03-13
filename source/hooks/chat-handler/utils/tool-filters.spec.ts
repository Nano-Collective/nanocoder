import test from 'ava';
import {filterValidToolCalls} from './tool-filters.js';
import type {ToolCall} from '@/types/core';
import type {ToolManager} from '@/tools/tool-manager';

test('filterValidToolCalls - filters out empty tool calls', t => {
	const toolCalls: ToolCall[] = [
		{
			id: '',
			function: {name: 'test', arguments: {}},
		},
		{
			id: 'call_1',
			function: {name: '', arguments: {}},
		},
		{
			id: 'call_2',
			function: {name: 'valid_tool', arguments: {}},
		},
	];

	const {validToolCalls, errorResults} = filterValidToolCalls(toolCalls, null);

	t.is(validToolCalls.length, 1);
	t.is(validToolCalls[0].id, 'call_2');
	t.is(errorResults.length, 0);
});

test('filterValidToolCalls - filters out whitespace-only tool names', t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {name: '   ', arguments: {}}, // Only whitespace
		},
		{
			id: 'call_2',
			function: {name: '\t\n', arguments: {}}, // Tab and newline
		},
		{
			id: 'call_3',
			function: {name: '  \t  \n  ', arguments: {}}, // Mixed whitespace
		},
		{
			id: 'call_4',
			function: {name: 'valid_tool', arguments: {}},
		},
	];

	const {validToolCalls, errorResults} = filterValidToolCalls(toolCalls, null);

	t.is(validToolCalls.length, 1);
	t.is(validToolCalls[0].id, 'call_4');
	t.is(errorResults.length, 0);
});

test('filterValidToolCalls - creates error for non-existent tools', t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {name: 'nonexistent_tool', arguments: {}},
		},
	];

	const mockToolManager = {
		hasTool: (name: string) => name === 'existing_tool',
	} as unknown as ToolManager;

	const {validToolCalls, errorResults} = filterValidToolCalls(
		toolCalls,
		mockToolManager,
	);

	t.is(validToolCalls.length, 0);
	t.is(errorResults.length, 1);
	t.is(errorResults[0].tool_call_id, 'call_1');
	t.is(errorResults[0].name, 'nonexistent_tool');
	t.true(errorResults[0].content.includes('does not exist'));
});

test('filterValidToolCalls - allows duplicate IDs through', t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {name: 'tool', arguments: {a: 1}},
		},
		{
			id: 'call_1', // Duplicate ID
			function: {name: 'tool', arguments: {a: 2}},
		},
	];

	const {validToolCalls} = filterValidToolCalls(toolCalls, null);

	t.is(validToolCalls.length, 2);
});

test('filterValidToolCalls - allows identical function signatures through', t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {name: 'tool', arguments: {a: 1}},
		},
		{
			id: 'call_2',
			function: {name: 'tool', arguments: {a: 1}}, // Same tool + args
		},
	];

	const {validToolCalls} = filterValidToolCalls(toolCalls, null);

	t.is(validToolCalls.length, 2);
});

test('filterValidToolCalls - allows different tool calls', t => {
	const toolCalls: ToolCall[] = [
		{
			id: 'call_1',
			function: {name: 'tool_a', arguments: {a: 1}},
		},
		{
			id: 'call_2',
			function: {name: 'tool_b', arguments: {b: 2}},
		},
		{
			id: 'call_3',
			function: {name: 'tool_a', arguments: {a: 2}}, // Same tool, different args
		},
	];

	const {validToolCalls} = filterValidToolCalls(toolCalls, null);

	t.is(validToolCalls.length, 3);
});
