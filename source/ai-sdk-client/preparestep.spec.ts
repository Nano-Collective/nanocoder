import test from 'ava';
import type {ModelMessage} from 'ai';
import {isEmptyAssistantMessage, type TestableMessage} from '@/ai-sdk-client';

// Tests for prepareStep message filtering logic
// This simulates the filtering logic used in AISDKClient.chat() to prevent:
// 1. "400 Bad Request: Assistant message must have either content or tool_calls"
// 2. "400 Bad Request: Unexpected role 'tool' after role 'user'"

/**
 * Simulates the prepareStep filtering logic from ai-sdk-client.ts
 * This is extracted for testing purposes
 */
function simulatePrepareStepFiltering(
	messages: ModelMessage[],
): ModelMessage[] {
	const filteredMessages: ModelMessage[] = [];
	const indicesToSkip = new Set<number>();

	// First pass: identify empty assistant messages and their orphaned tool results
	for (let i = 0; i < messages.length; i++) {
		if (isEmptyAssistantMessage(messages[i] as unknown as TestableMessage)) {
			indicesToSkip.add(i);

			// Mark any immediately following tool messages as orphaned
			let j = i + 1;
			while (j < messages.length && messages[j].role === 'tool') {
				indicesToSkip.add(j);
				j++;
			}
		}
	}

	// Second pass: build filtered array
	for (let i = 0; i < messages.length; i++) {
		if (!indicesToSkip.has(i)) {
			filteredMessages.push(messages[i]);
		}
	}

	return filteredMessages;
}

// ============================================================================
// Basic filtering tests
// ============================================================================

test('prepareStep - keeps valid messages unchanged', t => {
	const messages: ModelMessage[] = [
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: 'Hi there!'},
	];

	const filtered = simulatePrepareStepFiltering(messages);
	t.deepEqual(filtered, messages);
});

test('prepareStep - filters out empty assistant message', t => {
	const messages: ModelMessage[] = [
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: ''},
		{role: 'user', content: 'Are you there?'},
	];

	const filtered = simulatePrepareStepFiltering(messages);
	t.is(filtered.length, 2);
	t.is(filtered[0].role, 'user');
	t.is(filtered[1].role, 'user');
});

// ============================================================================
// Orphaned tool message tests (critical for fixing the bug)
// ============================================================================

test('prepareStep - filters out orphaned tool messages after empty assistant', t => {
	// This is the scenario that caused the bug:
	// user -> empty assistant -> tool -> tool
	// After filtering empty assistant, we'd have: user -> tool -> tool (INVALID!)
	const messages: ModelMessage[] = [
		{role: 'user', content: 'Read a file'},
		{role: 'assistant', content: ''}, // Empty assistant
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'tool_1',
					toolName: 'read_file',
					output: {type: 'text', value: 'file contents'},
				},
			],
		},
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'tool_2',
					toolName: 'read_file',
					output: {type: 'text', value: 'other file contents'},
				},
			],
		},
	];

	const filtered = simulatePrepareStepFiltering(messages);

	// Should only have the user message - empty assistant and orphaned tools removed
	t.is(filtered.length, 1);
	t.is(filtered[0].role, 'user');
});

test('prepareStep - keeps tool messages after valid assistant', t => {
	// Valid sequence: user -> assistant with content -> tool results
	// Note: tool_calls are part of the model response, not input messages
	const messages: ModelMessage[] = [
		{role: 'user', content: 'Read a file'},
		{
			role: 'assistant',
			content: 'Let me read that file for you.',
		},
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'tool_1',
					toolName: 'read_file',
					output: {type: 'text', value: 'file contents'},
				},
			],
		},
	];

	const filtered = simulatePrepareStepFiltering(messages);

	// All messages should be kept
	t.is(filtered.length, 3);
	t.is(filtered[0].role, 'user');
	t.is(filtered[1].role, 'assistant');
	t.is(filtered[2].role, 'tool');
});

test('prepareStep - handles multiple empty assistants with tool messages', t => {
	const messages: ModelMessage[] = [
		{role: 'user', content: 'First request'},
		{role: 'assistant', content: ''}, // Empty
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'tool_1',
					toolName: 'read_file',
					output: {type: 'text', value: 'file1'},
				},
			],
		},
		{role: 'user', content: 'Second request'},
		{role: 'assistant', content: ''}, // Empty
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'tool_2',
					toolName: 'read_file',
					output: {type: 'text', value: 'file2'},
				},
			],
		},
	];

	const filtered = simulatePrepareStepFiltering(messages);

	// Should only have the two user messages
	t.is(filtered.length, 2);
	t.is(filtered[0].role, 'user');
	t.is(filtered[1].role, 'user');
});

test('prepareStep - stops filtering tool messages at next non-tool message', t => {
	const messages: ModelMessage[] = [
		{role: 'user', content: 'Request'},
		{role: 'assistant', content: ''}, // Empty
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'tool_1',
					toolName: 'read_file',
					output: {type: 'text', value: 'file1'},
				},
			],
		},
		{role: 'assistant', content: 'Here is the result'}, // Valid assistant
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'tool_2',
					toolName: 'read_file',
					output: {type: 'text', value: 'file2'},
				},
			],
		},
	];

	const filtered = simulatePrepareStepFiltering(messages);

	// Empty assistant and its tool are removed, but valid assistant and its tool remain
	// However, the last tool message has no parent assistant with tool_calls, so it's orphaned
	// Actually, looking at the logic more carefully: we only filter tool messages that
	// IMMEDIATELY follow an empty assistant. So the last tool message would remain.
	t.is(filtered.length, 3);
	t.is(filtered[0].role, 'user');
	t.is(filtered[1].role, 'assistant');
	t.is(filtered[2].role, 'tool');
});

// ============================================================================
// Complex scenarios
// ============================================================================

test('prepareStep - handles empty assistant between valid messages', t => {
	const messages: ModelMessage[] = [
		{role: 'user', content: 'First request'},
		{role: 'assistant', content: 'First response'},
		{role: 'user', content: 'Second request'},
		{role: 'assistant', content: ''}, // Empty
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'tool_1',
					toolName: 'read_file',
					output: {type: 'text', value: 'file1'},
				},
			],
		},
		{role: 'assistant', content: 'Final response'},
	];

	const filtered = simulatePrepareStepFiltering(messages);

	// Empty assistant and orphaned tool removed, valid messages remain
	t.is(filtered.length, 4);
	t.is(filtered[0].role, 'user');
	t.is(filtered[1].role, 'assistant');
	t.is(filtered[2].role, 'user');
	t.is(filtered[3].role, 'assistant');
});

test('prepareStep - whitespace-only assistant content is considered empty', t => {
	const messages: ModelMessage[] = [
		{role: 'user', content: 'Request'},
		{role: 'assistant', content: '   \n\t  '}, // Whitespace only
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: 'tool_1',
					toolName: 'read_file',
					output: {type: 'text', value: 'file1'},
				},
			],
		},
	];

	const filtered = simulatePrepareStepFiltering(messages);

	// Whitespace-only assistant and orphaned tool are filtered
	t.is(filtered.length, 1);
	t.is(filtered[0].role, 'user');
});
