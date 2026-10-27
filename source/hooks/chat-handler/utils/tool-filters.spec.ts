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
	const {validToolCalls, rejectedToolCalls, errorResults} =
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
		rejectedToolCalls.map(c => c.id),
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

// A call to a real tool whose arguments could not be parsed (see
// convertAISDKToolCall): `{}` in their place, and the parse error.
const unparsableCall: ToolCall = {
	id: 'call_bad',
	function: {name: 'read_file', arguments: {}},
	argumentsError:
		"not valid JSON: Expected ',' or '}' after property value in JSON at position 20",
};

for (const [label, partition] of [
	['filterValidToolCalls', filterValidToolCalls],
	['partitionUnknownToolCalls', partitionUnknownToolCalls],
] as const) {
	test(`${label} - rejects a call to a real tool whose arguments could not be parsed`, t => {
		const {validToolCalls, rejectedToolCalls, errorResults} = partition(
			[
				{id: 'call_good', function: {name: 'read_file', arguments: {path: 'a'}}},
				unparsableCall,
			],
			managerWith(['read_file']),
		);

		t.deepEqual(
			validToolCalls.map(c => c.id),
			['call_good'],
		);
		t.deepEqual(
			rejectedToolCalls.map(c => c.id),
			['call_bad'],
		);
		t.is(errorResults.length, 1);
		t.is(errorResults[0].tool_call_id, 'call_bad');
		t.is(errorResults[0].name, 'read_file');
		t.true(errorResults[0].isError);
		t.is(
			errorResults[0].content,
			`Invalid arguments for tool "read_file": not valid JSON: Expected ',' or '}' after property value in JSON at position 20. The call was not run. Send it again with complete, valid JSON arguments; if they were cut off at the output-token limit, make the call smaller.`,
		);
	});
}

test('filterValidToolCalls - rejects unparsable arguments without a tool manager', t => {
	const {validToolCalls, errorResults} = filterValidToolCalls(
		[unparsableCall],
		null,
	);

	t.is(validToolCalls.length, 0);
	t.regex(errorResults[0].content, /^Invalid arguments for tool "read_file"/);
});

test('partitionUnknownToolCalls - an unknown tool is reported as unknown even with unparsable arguments', t => {
	// "Does not exist" is the more useful hint: the model has to pick another
	// tool before its arguments matter.
	const {errorResults} = partitionUnknownToolCalls(
		[{...unparsableCall, function: {name: 'ghost_tool', arguments: {}}}],
		managerWith(['read_file']),
	);

	t.deepEqual(
		errorResults.map(r => r.content),
		['Unknown tool: ghost_tool'],
	);
});

test('buildAbandonedTurnMessages - a call with unparsable arguments abandons the turn', t => {
	const partition = partitionUnknownToolCalls(
		[
			{id: 'call_good', function: {name: 'read_file', arguments: {path: 'a'}}},
			unparsableCall,
		],
		managerWith(['read_file']),
	);

	const {emittedToolCalls, resultsForAbandonedTurn} =
		buildAbandonedTurnMessages(partition);

	// Both calls stay in history, each paired with a result: the invalid one
	// with its error, the valid one with a cancellation, as for unknown tools.
	t.deepEqual(
		emittedToolCalls.map(c => c.id),
		['call_good', 'call_bad'],
	);
	t.deepEqual(
		resultsForAbandonedTurn.map(r => r.tool_call_id).sort(),
		['call_bad', 'call_good'],
	);
	// What is replayed for the invalid call is `{}`, never the raw text.
	t.deepEqual(emittedToolCalls[1].function.arguments, {});
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
