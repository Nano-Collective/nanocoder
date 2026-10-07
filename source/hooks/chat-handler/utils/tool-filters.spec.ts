import test from 'ava';
import {
	buildAbandonedTurnMessages,
	filterValidToolCalls,
	partitionUnknownToolCalls,
} from './tool-filters.js';
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
		getToolNames: () => ['existing_tool', 'read_file'],
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
	// The recovery hint lists the available tools.
	t.true(errorResults[0].content.includes('existing_tool'));
	t.true(errorResults[0].content.includes('read_file'));
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

// ============================================================================
// partitionUnknownToolCalls / buildAbandonedTurnMessages
// ============================================================================

const managerWith = (knownTools: string[]) =>
	({
		hasTool: (name: string) => knownTools.includes(name),
	}) as unknown as ToolManager;

test('partitionUnknownToolCalls - treats the XML validation marker as unknown', t => {
	const {validToolCalls, unknownToolCalls, errorResults} =
		partitionUnknownToolCalls(
			[
				{id: 'call_1', function: {name: 'known_tool', arguments: {}}},
				{id: 'call_2', function: {name: '__xml_validation_error__', arguments: {}}},
				{id: 'call_3', function: {name: 'ghost_tool', arguments: {}}},
			],
			managerWith(['known_tool', '__xml_validation_error__']),
		);

	t.deepEqual(
		validToolCalls.map(c => c.id),
		['call_1'],
	);
	t.deepEqual(
		unknownToolCalls.map(c => c.id),
		['call_2', 'call_3'],
	);
	t.deepEqual(
		errorResults.map(r => r.content),
		['Unknown tool: __xml_validation_error__', 'Unknown tool: ghost_tool'],
	);
});

test('buildAbandonedTurnMessages - every emitted call has a matching result', t => {
	// The invariant: a result whose tool_call is missing from the assistant
	// message is orphaned and pruned before the request goes out.
	const partition = partitionUnknownToolCalls(
		[
			{id: 'call_good', function: {name: 'known_tool', arguments: {}}},
			{id: 'call_ghost', function: {name: 'ghost_tool', arguments: {}}},
		],
		managerWith(['known_tool']),
	);

	const {emittedToolCalls, resultsForAbandonedTurn} =
		buildAbandonedTurnMessages(partition);

	t.deepEqual(
		emittedToolCalls.map(c => c.id),
		['call_good', 'call_ghost'],
	);
	const resultIds = new Set(resultsForAbandonedTurn.map(r => r.tool_call_id));
	for (const toolCall of emittedToolCalls) {
		t.true(resultIds.has(toolCall.id), `${toolCall.id} must be paired`);
	}
	const aborted = resultsForAbandonedTurn.find(
		r => r.tool_call_id === 'call_good',
	);
	t.regex(String(aborted?.content), /Execution aborted/);
});

test('buildAbandonedTurnMessages - a clean turn produces no abandoned results', t => {
	const partition = partitionUnknownToolCalls(
		[{id: 'call_good', function: {name: 'known_tool', arguments: {}}}],
		managerWith(['known_tool']),
	);

	const {emittedToolCalls, resultsForAbandonedTurn} =
		buildAbandonedTurnMessages(partition);

	t.is(emittedToolCalls.length, 1);
	t.is(resultsForAbandonedTurn.length, 0);
});
