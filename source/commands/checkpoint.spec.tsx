import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {Message} from '@/types/core';
import test from 'ava';
import React from 'react';
import {CheckpointManager} from '@/services/checkpoint-manager';
import {
	addPendingHookContext,
	clearPendingHookContext,
	drainPendingHookContext,
} from '@/services/lifecycle-hooks';
import {hasSeenFile, markFileSeen} from '@/utils/read-tracker';
import {
	clearExpandableToolResults,
	getExpandableToolResults,
	recordExpandableToolResult,
} from '@/utils/tool-result-display';
import {checkpointCommand, restoreCheckpointConversation} from './checkpoint';

// Helper to create mock messages
function createMockMessages(count: number): Message[] {
	const messages: Message[] = [];
	for (let i = 0; i < count; i++) {
		messages.push({
			role: i % 2 === 0 ? 'user' : 'assistant',
			content: `Message ${i + 1}`,
		});
	}
	return messages;
}

const mockMetadata = {
	provider: 'TestProvider',
	model: 'test-model',
};

// Command metadata tests
test('checkpointCommand has correct name', t => {
	t.is(checkpointCommand.name, 'checkpoint');
});

test('checkpointCommand has description', t => {
	t.truthy(checkpointCommand.description);
	t.true(checkpointCommand.description.length > 0);
});

test('checkpointCommand has handler function', t => {
	t.is(typeof checkpointCommand.handler, 'function');
});

// Help command tests
test('checkpointCommand shows help with no arguments', async t => {
	const result = await checkpointCommand.handler([], [], mockMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Checkpoint Commands'));
});

test('checkpointCommand shows help with help argument', async t => {
	const result = await checkpointCommand.handler(['help'], [], mockMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Checkpoint Commands'));
	t.true(output.includes('/checkpoint create'));
	t.true(output.includes('/checkpoint list'));
	t.true(output.includes('/checkpoint load'));
	t.true(output.includes('/checkpoint delete'));
});

test('checkpointCommand shows help with --help flag', async t => {
	const result = await checkpointCommand.handler(['--help'], [], mockMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Checkpoint Commands'));
});

test('checkpointCommand shows help with -h flag', async t => {
	const result = await checkpointCommand.handler(['-h'], [], mockMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Checkpoint Commands'));
});

// Create subcommand tests
test('checkpointCommand create warns when no messages', async t => {
	const result = await checkpointCommand.handler(['create'], [], mockMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('No messages to checkpoint'));
});

test('checkpointCommand create alias "save" works', async t => {
	const result = await checkpointCommand.handler(['save'], [], mockMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('No messages to checkpoint'));
});

// List subcommand tests
test('checkpointCommand list shows checkpoints', async t => {
	const result = await checkpointCommand.handler(['list'], [], mockMetadata);
	// Just verify it returns something (actual checkpoints depend on state)
	t.truthy(result);
});

test('checkpointCommand list alias "ls" works', async t => {
	const result = await checkpointCommand.handler(['ls'], [], mockMetadata);
	t.truthy(result);
});

// Load subcommand tests
test('checkpointCommand load with non-existent checkpoint shows error', async t => {
	const messages = createMockMessages(2);
	const result = await checkpointCommand.handler(
		['load', 'non-existent-checkpoint-xyz'],
		messages,
		mockMetadata,
	);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('does not exist'));
});

test('checkpointCommand load alias "restore" works', async t => {
	const messages = createMockMessages(2);
	const result = await checkpointCommand.handler(
		['restore', 'non-existent'],
		messages,
		mockMetadata,
	);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('does not exist'));
});

// Delete subcommand tests
test('checkpointCommand delete requires name', async t => {
	const result = await checkpointCommand.handler(['delete'], [], mockMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('specify a checkpoint name'));
});

test('checkpointCommand delete with non-existent checkpoint shows error', async t => {
	const result = await checkpointCommand.handler(
		['delete', 'non-existent-checkpoint-xyz'],
		[],
		mockMetadata,
	);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('does not exist'));
});

test('checkpointCommand delete alias "remove" works', async t => {
	const result = await checkpointCommand.handler(
		['remove', 'non-existent'],
		[],
		mockMetadata,
	);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('does not exist'));
});

test('checkpointCommand delete alias "rm" works', async t => {
	const result = await checkpointCommand.handler(
		['rm', 'non-existent'],
		[],
		mockMetadata,
	);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('does not exist'));
});

// Unknown subcommand tests
test('checkpointCommand shows error for unknown subcommand', async t => {
	const result = await checkpointCommand.handler(['unknown'], [], mockMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Unknown checkpoint subcommand'));
	t.true(output.includes('unknown'));
	t.true(output.includes('/checkpoint help'));
});

test('checkpointCommand handles subcommand case-insensitively', async t => {
	const result1 = await checkpointCommand.handler(['HELP'], [], mockMetadata);
	const result2 = await checkpointCommand.handler(['Help'], [], mockMetadata);
	const result3 = await checkpointCommand.handler(['LIST'], [], mockMetadata);

	const {lastFrame: frame1} = renderWithTheme(result1 as React.ReactElement);
	const {lastFrame: frame2} = renderWithTheme(result2 as React.ReactElement);

	t.true((frame1() || '').includes('Checkpoint Commands'));
	t.true((frame2() || '').includes('Checkpoint Commands'));
	t.truthy(result3); // Just verify it doesn't throw
});

// Multiple word checkpoint name tests
test('checkpointCommand delete handles multi-word names', async t => {
	const result = await checkpointCommand.handler(
		['delete', 'my', 'checkpoint', 'name'],
		[],
		mockMetadata,
	);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	// Should join the words and look for "my checkpoint name"
	t.true(output.includes('my checkpoint name'));
});

test('checkpointCommand load handles multi-word names', async t => {
	const result = await checkpointCommand.handler(
		['load', 'my', 'checkpoint', 'name'],
		[],
		mockMetadata,
	);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('my checkpoint name'));
});

// Handler returns React elements
test('checkpointCommand handler returns React element', async t => {
	const result = await checkpointCommand.handler(['help'], [], mockMetadata);
	t.true(React.isValidElement(result));
});

test('checkpointCommand create handler returns React element', async t => {
	const result = await checkpointCommand.handler(['create'], [], mockMetadata);
	t.true(React.isValidElement(result));
});

test('checkpointCommand list handler returns React element', async t => {
	const result = await checkpointCommand.handler(['list'], [], mockMetadata);
	t.true(React.isValidElement(result));
});

test('checkpointCommand delete handler returns React element', async t => {
	const result = await checkpointCommand.handler(['delete'], [], mockMetadata);
	t.true(React.isValidElement(result));
});

// Verify help content is comprehensive
test('checkpointCommand help includes all subcommands', async t => {
	const result = await checkpointCommand.handler(['help'], [], mockMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	// Check for create subcommand
	t.true(output.includes('create'));
	t.true(output.includes('snapshot'));

	// Check for list subcommand
	t.true(output.includes('list'));

	// Check for load subcommand
	t.true(output.includes('load'));
	t.true(output.includes('restore') || output.includes('Interactive'));

	// Check for delete subcommand
	t.true(output.includes('delete'));

	// Check for help subcommand
	t.true(output.includes('help'));
});

test('checkpointCommand help includes examples', async t => {
	const result = await checkpointCommand.handler(['help'], [], mockMetadata);
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Example'));
});

// Restore-conversation tests (issue #1242: load must roll back the transcript,
// not just workspace files). These append to the suite above; they do not
// replace the existing subcommand coverage.
test('restoreCheckpointConversation restores messages and resets per-conversation state', async t => {
	clearPendingHookContext();
	clearExpandableToolResults();
	const restored: Message[] = [
		{role: 'user', content: 'hello'},
		{role: 'assistant', content: 'hi'},
	];
	let seen: Message[] | null = null;
	let contextCleared = false;

	markFileSeen('/tmp/checkpoint-restore-seen.txt');
	recordExpandableToolResult(
		{toolCallId: 'c1', name: 'read_file', arguments: {}},
		{toolCallId: 'c1', name: 'read_file', content: 'x', isError: false},
	);
	addPendingHookContext('stale session-start output');

	await restoreCheckpointConversation(restored, {
		setMessages: messages => {
			seen = messages;
		},
		client: {clearContext: async () => {
			contextCleared = true;
		}} as never,
	});

	t.deepEqual(seen, restored);
	t.false(hasSeenFile('/tmp/checkpoint-restore-seen.txt'));
	t.is(getExpandableToolResults().length, 0);
	t.is(drainPendingHookContext(), '');
	t.true(contextCleared);
});

test('restoreCheckpointConversation works without setMessages or client', async t => {
	const restored: Message[] = [{role: 'user', content: 'solo'}];
	// Should not throw when both optionals are absent.
	await restoreCheckpointConversation(restored, {});
	t.pass();
});

test('checkpointCommand load restores transcript via setMessages (wired flow)', async t => {
	const checkpointed: Message[] = [
		{role: 'user', content: 'checkpointed question'},
		{role: 'assistant', content: 'checkpointed answer'},
	];
	const current: Message[] = [
		...checkpointed,
		{role: 'user', content: 'later drift'},
	];
	let seen: Message[] | null = null;
	let contextCleared = false;

	const origExists = CheckpointManager.prototype.checkpointExists;
	const origLoad = CheckpointManager.prototype.loadCheckpoint;
	const origRestore = CheckpointManager.prototype.restoreFiles;
	CheckpointManager.prototype.checkpointExists = () => true;
	CheckpointManager.prototype.loadCheckpoint = async () =>
		({
			metadata: {
				name: 'wired-cp',
				timestamp: new Date().toISOString(),
				messageCount: checkpointed.length,
				filesChanged: [],
				provider: {name: 'TestProvider', model: 'test-model'},
				description: 'test',
			},
			conversation: {messages: checkpointed},
			fileSnapshots: new Map(),
		}) as never;
	CheckpointManager.prototype.restoreFiles = async () => [];

	try {
		const result = await checkpointCommand.handler(['load', 'wired-cp'], current, {
			...mockMetadata,
			tokens: 0,
			getMessageTokens: () => 0,
			setMessages: messages => {
				seen = messages;
			},
			client: {clearContext: async () => {
				contextCleared = true;
			}} as never,
		});
		t.true(React.isValidElement(result));
		t.deepEqual(seen, checkpointed);
		t.true(contextCleared);
	} finally {
		CheckpointManager.prototype.checkpointExists = origExists;
		CheckpointManager.prototype.loadCheckpoint = origLoad;
		CheckpointManager.prototype.restoreFiles = origRestore;
	}
});
