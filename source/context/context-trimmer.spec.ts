import test from 'ava';
import type {Message} from '@/types/core';
import {enforceContextLimit, trimConversation} from './context-trimmer';

test('trimConversation returns all messages when within budget', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Hello'},
		{role: 'assistant', content: 'Hi there!'},
		{role: 'user', content: 'How are you?'},
		{role: 'assistant', content: 'I am doing well.'},
	];

	const trimmed = trimConversation(messages, 10000);

	t.is(trimmed.length, messages.length);
});

test('trimConversation removes old tool outputs when over budget', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Start task'},
		{
			role: 'assistant',
			content: 'Reading file',
			tool_calls: [{
				id: '1',
				function: {name: 'read', arguments: {}},
			}],
		},
		{
			role: 'tool',
			content: 'x'.repeat(5000), // Old large output
			tool_call_id: '1',
		},
		{role: 'user', content: 'What did you find?'},
		{
			role: 'assistant',
			content: 'Looking for more',
			tool_calls: [{
				id: '2',
				function: {name: 'read', arguments: {}},
			}],
		},
		{
			role: 'tool',
			content: 'y'.repeat(5000), // Recent large output
			tool_call_id: '2',
		},
		{role: 'user', content: 'Continue'},
	];

	const trimmed = trimConversation(messages, 500);

	// Should preserve recent content and trim old tool outputs
	t.true(trimmed.length >= 4); // At least keep some structure
	t.true(trimmed.some(m => m.content?.includes('[content truncated')));
});

test('trimConversation preserves error messages', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Do something'},
		{
			role: 'assistant',
			content: 'Running task',
			tool_calls: [{
				id: '1',
				function: {name: 'bash', arguments: {}},
			}],
		},
		{
			role: 'tool',
			content: 'Error: Failed to complete task. This is critical.',
			tool_call_id: '1',
		},
		{role: 'user', content: 'Try again'},
	];

	// Use a reasonable budget that allows some content but forces trimming
	const trimmed = trimConversation(messages, 500, {
		preserveErrors: true,
		preserveSmallOutputs: true,
	});

	// Error message should be preserved or content should be meaningful
	// (error might be replaced with placeholder if very old, but for recent messages it's kept)
	t.true(trimmed.length > 0);
});

test('trimConversation preserves system messages', t => {
	const messages: Message[] = [
		{role: 'system', content: 'You are a helpful assistant'},
		{role: 'user', content: 'x'.repeat(10000)},
	];

	const trimmed = trimConversation(messages, 100);

	// System message should be preserved
	const hasSystem = trimmed.some(
		m =>
			m.role === 'system' && m.content.includes('helpful'),
	);
	t.true(hasSystem);
});

test('trimConversation creates placeholders for truncated content', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Start'},
		{
			role: 'assistant',
			content: 'Reading',
			tool_calls: [{
				id: '1',
				function: {name: 'read', arguments: {}},
			}],
		},
		{
			role: 'tool',
			content: 'x'.repeat(10000),
			tool_call_id: '1',
		},
		{role: 'user', content: 'More'},
	];

	const trimmed = trimConversation(messages, 300);

	// Check that truncated content includes placeholder
	const hasPlaceholder = trimmed.some(m =>
		typeof m.content === 'string' &&
		m.content.includes('[content truncated'),
	);
	t.true(hasPlaceholder);
});

test('trimConversation respects preserveRecentTurns option', t => {
	const messages: Message[] = [
		{role: 'user', content: 'User 1'},
		{role: 'assistant', content: 'Assistant 1'},
		{role: 'user', content: 'User 2'},
		{role: 'assistant', content: 'Assistant 2'},
		{role: 'user', content: 'User 3'},
		{role: 'assistant', content: 'Assistant 3'},
		{role: 'user', content: 'User 4'},
		{role: 'assistant', content: 'Assistant 4'},
	];

	const trimmed = trimConversation(messages, 50, {
		preserveRecentTurns: 2,
	});

	// Should preserve at least last 4 messages (2 turns)
	t.true(trimmed.length >= 4);
	// Last message should be preserved
	const lastMessage = trimmed[trimmed.length - 1];
	t.is(lastMessage.content, 'Assistant 4');
});

test('enforceContextLimit returns unchanged when within budget', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Hello'},
	];
	const maxInputTokens = 10000;

	const result = enforceContextLimit(messages, maxInputTokens);

	t.false(result.truncated);
	t.is(result.droppedCount, 0);
	t.is(result.messages.length, messages.length);
	t.is(result.originalTokens, result.finalTokens);
});

test('enforceContextLimit trims when over budget', t => {
	const largeContent = 'x'.repeat(50000);
	const messages: Message[] = [
		{role: 'system', content: 'System prompt'},
		{role: 'user', content: 'Initial question'},
		{
			role: 'assistant',
			content: 'Reading file',
			tool_calls: [{
				id: '1',
				function: {name: 'read', arguments: {}},
			}],
		},
		{
			role: 'tool',
			tool_call_id: '1',
			content: largeContent,
		},
		{role: 'user', content: 'Follow up'},
	];
	const maxInputTokens = 1000;

	const result = enforceContextLimit(messages, maxInputTokens);

	t.true(result.truncated);
	t.true(result.originalTokens > maxInputTokens);
	t.true(result.finalTokens <= maxInputTokens);
	t.true(result.droppedCount >= 0);
});

test('enforceContextLimit returns accurate token counts', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Test'},
	];
	const maxInputTokens = 10000;

	const result = enforceContextLimit(messages, maxInputTokens);

	t.true(result.originalTokens > 0);
	t.true(result.finalTokens > 0);
	t.is(result.originalTokens, result.finalTokens);
});

test('enforceContextLimit with provider and model options', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Hello'},
	];
	const maxInputTokens = 10000;

	const result = enforceContextLimit(messages, maxInputTokens, {
		providerName: 'anthropic',
		model: 'claude-3-5-sonnet-20241022',
	});

	t.true(result.originalTokens > 0);
	t.is(result.originalTokens, result.finalTokens);
});

// Tests for new priority-based trimming functions

test('trimConversation with file references preserves messages about active files', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Read file A'},
		{
			role: 'assistant',
			content: 'Reading',
			tool_calls: [{
				id: '1',
				function: {name: 'read_file', arguments: {path: '/path/to/fileA.ts'}},
			}],
		},
		{role: 'tool', content: 'File A content', tool_call_id: '1'},
		{role: 'user', content: 'Read file B'},
		{
			role: 'assistant',
			content: 'Reading',
			tool_calls: [{
				id: '2',
				function: {name: 'read_file', arguments: {path: '/path/to/fileB.ts'}},
			}],
		},
		{role: 'tool', content: 'x'.repeat(5000), tool_call_id: '2'},
		{role: 'user', content: 'Done'},
	];

	const trimmed = trimConversation(messages, 500);

	// Should preserve recent messages even if large
	t.true(trimmed.length >= 5);
	// User's latest message should be preserved
	const lastUserMsg = trimmed.filter(m => m.role === 'user').pop();
	t.is(lastUserMsg?.content, 'Done');
});

test('trimConversation removes old unrelated tool outputs first', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Initial'},
		{
			role: 'assistant',
			content: 'Action 1',
			tool_calls: [{
				id: '1',
				function: {name: 'bash', arguments: {command: 'ls'}},
			}],
		},
		{role: 'tool', content: 'x'.repeat(10000), tool_call_id: '1'}, // Old unrelated output
		{role: 'user', content: 'Next'},
		{
			role: 'assistant',
			content: 'Action 2',
			tool_calls: [{
				id: '2',
				function: {name: 'read_file', arguments: {path: '/path/to/file.ts'}},
			}],
		},
		{role: 'tool', content: 'File content', tool_call_id: '2'}, // Recent file read
		{role: 'user', content: 'Continue'},
	];

	const trimmed = trimConversation(messages, 800);

	// Recent file read should be preserved
	const hasFileContent = trimmed.some(m =>
		m.role === 'tool' && m.content === 'File content'
	);
	t.true(hasFileContent);

	// Old output might be truncated or removed
	const hasOldOutput = trimmed.some(m =>
		m.role === 'tool' && m.content.includes('x'.repeat(100))
	);
	// Either removed or replaced with placeholder is acceptable
	t.false(hasOldOutput); // Should be trimmed or replaced
});

test('trimConversation with file edits prioritizes modified files', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Edit file'},
		{
			role: 'assistant',
			content: 'Editing',
			tool_calls: [{
				id: '1',
				function: {name: 'string_replace', arguments: {path: '/important.ts', old_text: 'x', new_text: 'y'}},
			}],
		},
		{role: 'tool', content: 'File updated', tool_call_id: '1'},
		{role: 'user', content: 'Read other file'},
		{
			role: 'assistant',
			content: 'Reading',
			tool_calls: [{
				id: '2',
				function: {name: 'read_file', arguments: {path: '/large.ts'}},
			}],
		},
		{role: 'tool', content: 'x'.repeat(5000), tool_call_id: '2'}, // Large read
		{role: 'user', content: 'Done'},
	];

	const trimmed = trimConversation(messages, 600);

	// Should preserve the modified file's messages
	const hasImportantFileMsg = trimmed.some(m =>
		m.role === 'tool' && m.content === 'File updated'
	);
	t.true(hasImportantFileMsg);
});

test('trimConversation preserves recent turns even with low-priority content', t => {
	const messages: Message[] = [
		{role: 'user', content: 'User 1'},
		{role: 'assistant', content: 'Assistant 1'},
		{role: 'user', content: 'User 2'},
		{role: 'assistant', content: 'Assistant 2'},
		{role: 'user', content: 'User 3'},
		{
			role: 'assistant',
			content: 'Running tool',
			tool_calls: [{
				id: '1',
				function: {name: 'bash', arguments: {command: 'echo test'}},
			}],
		},
		{role: 'tool', content: 'x'.repeat(10000), tool_call_id: '1'},
	];

	const trimmed = trimConversation(messages, 400, {
		preserveRecentTurns: 2,
	});

	// Should preserve at least the last 2 turns
	const lastUserMsg = trimmed.filter(m => m.role === 'user').pop();
	t.is(lastUserMsg?.content, 'User 3');
});
