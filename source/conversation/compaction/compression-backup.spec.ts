import test from 'ava';
import type {Message} from '@/types/core';
import {compressionBackup} from './compression-backup.js';

// Clear backup before each test
test.beforeEach(() => {
	compressionBackup.clearBackup();
});

// Helper to create messages
function createUserMessage(content: string): Message {
	return {role: 'user', content};
}

function createAssistantMessage(content: string): Message {
	return {role: 'assistant', content};
}

function createToolMessage(name: string, content: string): Message {
	return {
		role: 'tool',
		name,
		content,
		tool_call_id: `tool_${Date.now()}`,
	};
}

// ==================== Initial state ====================

test('compressionBackup starts with no backup', t => {
	t.false(compressionBackup.hasBackup());
	t.is(compressionBackup.getBackup(), null);
	t.is(compressionBackup.getTimestamp(), null);
});

// ==================== Store backup ====================

test('storeBackup stores messages correctly', t => {
	const messages: Message[] = [
		createUserMessage('Hello'),
		createAssistantMessage('Hi there'),
	];

	compressionBackup.storeBackup(messages);

	t.true(compressionBackup.hasBackup());
	t.not(compressionBackup.getBackup(), null);
});

test('storeBackup creates a deep copy of messages', t => {
	const messages: Message[] = [createUserMessage('Original')];

	compressionBackup.storeBackup(messages);

	// Modify original
	messages[0]!.content = 'Modified';

	// Backup should still have original content
	const backup = compressionBackup.getBackup();
	t.is(backup?.[0]?.content, 'Original');
});

test('storeBackup sets timestamp', t => {
	const before = Date.now();
	compressionBackup.storeBackup([createUserMessage('Test')]);
	const after = Date.now();

	const timestamp = compressionBackup.getTimestamp();
	t.not(timestamp, null);
	t.true(timestamp! >= before);
	t.true(timestamp! <= after);
});

test('storeBackup overwrites previous backup', t => {
	const messages1: Message[] = [createUserMessage('First')];
	const messages2: Message[] = [createUserMessage('Second')];

	compressionBackup.storeBackup(messages1);
	compressionBackup.storeBackup(messages2);

	const backup = compressionBackup.getBackup();
	t.is(backup?.length, 1);
	t.is(backup?.[0]?.content, 'Second');
});

test('storeBackup handles empty array', t => {
	compressionBackup.storeBackup([]);

	t.true(compressionBackup.hasBackup());
	const backup = compressionBackup.getBackup();
	t.deepEqual(backup, []);
});

// ==================== Get backup ====================

test('getBackup returns a copy, not the original', t => {
	const messages: Message[] = [createUserMessage('Test')];
	compressionBackup.storeBackup(messages);

	const backup1 = compressionBackup.getBackup();
	const backup2 = compressionBackup.getBackup();

	// Should be different array instances
	t.not(backup1, backup2);

	// But with same content
	t.deepEqual(backup1, backup2);
});

test('getBackup preserves all message properties', t => {
	const messages: Message[] = [
		{
			role: 'assistant',
			content: 'Let me help',
			tool_calls: [
				{
					id: 'call_1',
					function: {
						name: 'read_file',
						arguments: {path: '/test.txt'},
					},
				},
			],
		},
		createToolMessage('read_file', 'File content'),
	];

	compressionBackup.storeBackup(messages);
	const backup = compressionBackup.getBackup();

	t.is(backup?.[0]?.role, 'assistant');
	t.is(backup?.[0]?.tool_calls?.length, 1);
	t.is(backup?.[0]?.tool_calls?.[0]?.function?.name, 'read_file');
	t.is(backup?.[1]?.role, 'tool');
	t.is(backup?.[1]?.name, 'read_file');
});

// ==================== Has backup ====================

test('hasBackup returns false when no backup exists', t => {
	t.false(compressionBackup.hasBackup());
});

test('hasBackup returns true after storing backup', t => {
	compressionBackup.storeBackup([createUserMessage('Test')]);
	t.true(compressionBackup.hasBackup());
});

test('hasBackup returns false after clearing backup', t => {
	compressionBackup.storeBackup([createUserMessage('Test')]);
	compressionBackup.clearBackup();
	t.false(compressionBackup.hasBackup());
});

// ==================== Clear backup ====================

test('clearBackup removes the backup', t => {
	compressionBackup.storeBackup([createUserMessage('Test')]);
	compressionBackup.clearBackup();

	t.false(compressionBackup.hasBackup());
	t.is(compressionBackup.getBackup(), null);
});

test('clearBackup resets timestamp', t => {
	compressionBackup.storeBackup([createUserMessage('Test')]);
	compressionBackup.clearBackup();

	t.is(compressionBackup.getTimestamp(), null);
});

test('clearBackup is idempotent', t => {
	compressionBackup.clearBackup();
	compressionBackup.clearBackup();

	t.false(compressionBackup.hasBackup());
});

// ==================== Restore ====================

test('restore returns null when no backup exists', t => {
	const restored = compressionBackup.restore();
	t.is(restored, null);
});

test('restore returns a copy of the backup', t => {
	const messages: Message[] = [
		createUserMessage('Hello'),
		createAssistantMessage('Hi'),
	];

	compressionBackup.storeBackup(messages);
	const restored = compressionBackup.restore();

	t.not(restored, null);
	t.is(restored?.length, 2);
	t.is(restored?.[0]?.content, 'Hello');
	t.is(restored?.[1]?.content, 'Hi');
});

test('restore returns independent copy each time', t => {
	compressionBackup.storeBackup([createUserMessage('Test')]);

	const restored1 = compressionBackup.restore();
	const restored2 = compressionBackup.restore();

	t.not(restored1, restored2);
	t.deepEqual(restored1, restored2);
});

test('restore does not clear the backup', t => {
	compressionBackup.storeBackup([createUserMessage('Test')]);

	compressionBackup.restore();

	t.true(compressionBackup.hasBackup());
});

test('modifying restored messages does not affect backup', t => {
	compressionBackup.storeBackup([createUserMessage('Original')]);

	const restored = compressionBackup.restore();
	if (restored && restored[0]) {
		restored[0].content = 'Modified';
	}

	const backupAgain = compressionBackup.getBackup();
	t.is(backupAgain?.[0]?.content, 'Original');
});

// ==================== Store/restore cycle ====================

test('full store/restore cycle preserves messages', t => {
	const messages: Message[] = [
		createUserMessage('User message 1'),
		createAssistantMessage('Assistant response'),
		createToolMessage('execute_bash', 'Command output'),
		createUserMessage('User message 2'),
	];

	compressionBackup.storeBackup(messages);
	const restored = compressionBackup.restore();

	t.deepEqual(restored, messages);
});

test('multiple store/restore cycles work correctly', t => {
	const messages1: Message[] = [createUserMessage('First')];
	const messages2: Message[] = [createUserMessage('Second')];

	// First cycle
	compressionBackup.storeBackup(messages1);
	const restored1 = compressionBackup.restore();
	t.is(restored1?.[0]?.content, 'First');

	// Second cycle (overwrites first)
	compressionBackup.storeBackup(messages2);
	const restored2 = compressionBackup.restore();
	t.is(restored2?.[0]?.content, 'Second');

	// Clear and verify
	compressionBackup.clearBackup();
	const restored3 = compressionBackup.restore();
	t.is(restored3, null);
});

// ==================== Timestamp ====================

test('getTimestamp returns null initially', t => {
	t.is(compressionBackup.getTimestamp(), null);
});

test('getTimestamp returns number after storing', t => {
	compressionBackup.storeBackup([createUserMessage('Test')]);
	const timestamp = compressionBackup.getTimestamp();
	t.is(typeof timestamp, 'number');
});

test('getTimestamp updates on new backup', t => {
	compressionBackup.storeBackup([createUserMessage('First')]);
	const timestamp1 = compressionBackup.getTimestamp();

	// Small delay to ensure different timestamp
	const delay = new Promise(resolve => setTimeout(resolve, 10));
	return delay.then(() => {
		compressionBackup.storeBackup([createUserMessage('Second')]);
		const timestamp2 = compressionBackup.getTimestamp();

		t.true(timestamp2! >= timestamp1!);
	});
});

// ==================== Edge cases ====================

test('handles messages with undefined content', t => {
	const messages: Message[] = [
		{role: 'user', content: undefined as unknown as string},
	];

	compressionBackup.storeBackup(messages);
	const restored = compressionBackup.restore();

	t.is(restored?.[0]?.content, undefined);
});

test('handles large number of messages', t => {
	const messages: Message[] = Array.from({length: 100}, (_, i) =>
		createUserMessage(`Message ${i}`),
	);

	compressionBackup.storeBackup(messages);
	const restored = compressionBackup.restore();

	t.is(restored?.length, 100);
	t.is(restored?.[0]?.content, 'Message 0');
	t.is(restored?.[99]?.content, 'Message 99');
});

test('handles messages with complex tool_calls', t => {
	const messages: Message[] = [
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_1',
					function: {
						name: 'complex_tool',
						arguments: {
							nested: {
								deeply: {
									value: 'test',
								},
							},
							array: [1, 2, 3],
						},
					},
				},
			],
		},
	];

	compressionBackup.storeBackup(messages);
	const restored = compressionBackup.restore();

	const args = restored?.[0]?.tool_calls?.[0]?.function?.arguments as {
		nested: {deeply: {value: string}};
		array: number[];
	};
	t.is(args?.nested?.deeply?.value, 'test');
	t.deepEqual(args?.array, [1, 2, 3]);
});
