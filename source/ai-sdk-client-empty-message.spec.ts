import test from 'ava';
import {isEmptyAssistantMessage, TestableMessage} from './ai-sdk-client.js';

// Tests for isEmptyAssistantMessage function
// This function is used to filter out empty assistant messages that would cause API errors:
// "400 Bad Request: Assistant message must have either content or tool_calls, but not none."

// ============================================================================
// Non-assistant messages should never be considered empty
// ============================================================================

test('isEmptyAssistantMessage - user message is not empty', t => {
	const message: TestableMessage = {
		role: 'user',
		content: '',
	};
	t.false(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage - system message is not empty', t => {
	const message: TestableMessage = {
		role: 'system',
		content: '',
	};
	t.false(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage - tool message is not empty', t => {
	const message: TestableMessage = {
		role: 'tool',
		content: '',
	};
	t.false(isEmptyAssistantMessage(message));
});

// ============================================================================
// Empty assistant messages (should be filtered out)
// ============================================================================

test('isEmptyAssistantMessage - assistant with empty string content is empty', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: '',
	};
	t.true(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage - assistant with whitespace-only content is empty', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: '   \n\t  ',
	};
	t.true(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage - assistant with empty array content is empty', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: [],
	};
	t.true(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage - assistant with empty content and empty toolCalls is empty', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: '',
		toolCalls: [],
	};
	t.true(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage - assistant with undefined toolCalls is empty', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: '',
		toolCalls: undefined,
	};
	t.true(isEmptyAssistantMessage(message));
});

// ============================================================================
// Valid assistant messages (should NOT be filtered out)
// ============================================================================

test('isEmptyAssistantMessage - assistant with text content is not empty', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: 'Hello, how can I help you?',
	};
	t.false(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage - assistant with single character content is not empty', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: 'a',
	};
	t.false(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage - assistant with array content is not empty', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: [{type: 'text', text: 'Hello'}],
	};
	t.false(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage - assistant with toolCalls is not empty', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: '',
		toolCalls: [
			{toolName: 'read_file', toolCallId: '123', input: {path: 'test.txt'}},
		],
	};
	t.false(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage - assistant with content and toolCalls is not empty', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: 'Let me read that file for you.',
		toolCalls: [
			{toolName: 'read_file', toolCallId: '123', input: {path: 'test.txt'}},
		],
	};
	t.false(isEmptyAssistantMessage(message));
});

test('isEmptyAssistantMessage - assistant with whitespace content but toolCalls is not empty', t => {
	const message: TestableMessage = {
		role: 'assistant',
		content: '   ',
		toolCalls: [
			{toolName: 'read_file', toolCallId: '123', input: {path: 'test.txt'}},
		],
	};
	t.false(isEmptyAssistantMessage(message));
});
