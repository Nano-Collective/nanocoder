import test from 'ava';
import type {Message} from '@/types/core';
import type {Tokenizer} from '@/types/tokenization';
import {COMPRESSION_CONSTANTS, compressMessages} from './message-compression.js';

// Mock tokenizer that counts characters as tokens (1 char = 1 token)
function createMockTokenizer(): Tokenizer {
	return {
		countTokens: (msg: Message) => {
			const content = msg.content || '';
			const toolCallsLength = msg.tool_calls
				? JSON.stringify(msg.tool_calls).length
				: 0;
			return content.length + toolCallsLength;
		},
		free: () => {},
	};
}

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

function createSystemMessage(content: string): Message {
	return {role: 'system', content};
}

// ==================== Empty and edge cases ====================

test('compressMessages handles empty message array', t => {
	const tokenizer = createMockTokenizer();
	const result = compressMessages([], tokenizer, {mode: 'default'});

	t.deepEqual(result.compressedMessages, []);
	t.is(result.originalTokenCount, 0);
	t.is(result.compressedTokenCount, 0);
	t.is(result.reductionPercentage, 0);
	t.deepEqual(result.preservedInfo, {
		keyDecisions: 0,
		fileModifications: 0,
		toolResults: 0,
		recentMessages: 0,
	});
});

test('compressMessages handles messages with only system messages', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [
		createSystemMessage('You are a helpful assistant.'),
		createSystemMessage('Additional context here.'),
	];

	const result = compressMessages(messages, tokenizer, {mode: 'default'});

	// System messages should be preserved
	t.is(result.compressedMessages.length, 2);
	t.true(result.compressedMessages.every(m => m.role === 'system'));
});

test('compressMessages handles very short conversations (less than keepRecent)', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [createUserMessage('Hello')];

	const result = compressMessages(messages, tokenizer, {
		mode: 'default',
		keepRecentMessages: 2,
	});

	// Single message should be kept as recent
	t.is(result.compressedMessages.length, 1);
	t.is(result.compressedMessages[0]?.content, 'Hello');
});

test('compressMessages handles messages with undefined content', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [
		{role: 'user', content: undefined as unknown as string},
		{role: 'assistant', content: undefined as unknown as string},
	];

	// Should not throw
	const result = compressMessages(messages, tokenizer, {mode: 'default'});
	t.is(result.compressedMessages.length, 2);
});

test('compressMessages handles messages with empty string content', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [
		createUserMessage(''),
		createAssistantMessage(''),
	];

	const result = compressMessages(messages, tokenizer, {mode: 'default'});
	t.is(result.compressedMessages.length, 2);
});

// ==================== Default mode tests ====================

test('compressMessages default mode preserves recent messages', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [
		createUserMessage('Old message 1'),
		createAssistantMessage('Old response 1'),
		createUserMessage('Recent message'),
		createAssistantMessage('Recent response'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'default',
		keepRecentMessages: 2,
	});

	// Last 2 messages should be preserved exactly
	t.is(result.compressedMessages.length, 4);
	t.is(result.compressedMessages[2]?.content, 'Recent message');
	t.is(result.compressedMessages[3]?.content, 'Recent response');
});

test('compressMessages default mode compresses long user messages', t => {
	const tokenizer = createMockTokenizer();
	const longContent = 'A'.repeat(600); // Exceeds USER_MESSAGE_COMPRESSION_THRESHOLD (500)
	const messages: Message[] = [
		createUserMessage(longContent),
		createUserMessage('Recent'),
		createAssistantMessage('Response'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'default',
		keepRecentMessages: 2,
	});

	// First message should be compressed
	const firstMessage = result.compressedMessages[0];
	t.true((firstMessage?.content?.length ?? 0) < longContent.length);
	t.true(firstMessage?.content?.endsWith('...') ?? false);
});

test('compressMessages default mode compresses tool results', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [
		createToolMessage('read_file', 'File content here with lots of data...'),
		createUserMessage('Recent'),
		createAssistantMessage('Response'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'default',
		keepRecentMessages: 2,
	});

	// Tool message should be compressed
	const toolMsg = result.compressedMessages[0];
	t.true(toolMsg?.content?.includes('Tool: read_file') ?? false);
});

// ==================== Aggressive mode tests ====================

test('compressMessages aggressive mode compresses more aggressively', t => {
	const tokenizer = createMockTokenizer();
	const longContent = 'A'.repeat(600);
	const messages: Message[] = [
		createUserMessage(longContent),
		createUserMessage('Recent'),
		createAssistantMessage('Response'),
	];

	const defaultResult = compressMessages(messages, tokenizer, {
		mode: 'default',
		keepRecentMessages: 2,
	});

	const aggressiveResult = compressMessages(messages, tokenizer, {
		mode: 'aggressive',
		keepRecentMessages: 2,
	});

	// Aggressive should produce shorter content than default
	const defaultFirstLen = defaultResult.compressedMessages[0]?.content?.length ?? 0;
	const aggressiveFirstLen = aggressiveResult.compressedMessages[0]?.content?.length ?? 0;
	t.true(aggressiveFirstLen <= defaultFirstLen);
});

test('compressMessages aggressive mode reduces tool results to minimal', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [
		createToolMessage('execute_bash', 'Command executed successfully with output'),
		createUserMessage('Recent'),
		createAssistantMessage('Response'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'aggressive',
		keepRecentMessages: 2,
	});

	const toolMsg = result.compressedMessages[0];
	t.true(toolMsg?.content?.includes('Tool:') ?? false);
	t.true(toolMsg?.content?.includes('success') ?? false);
});

// ==================== Conservative mode tests ====================

test('compressMessages conservative mode preserves short user messages', t => {
	const tokenizer = createMockTokenizer();
	const shortContent = 'Short message';
	const messages: Message[] = [
		createUserMessage(shortContent),
		createUserMessage('Recent'),
		createAssistantMessage('Response'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'conservative',
		keepRecentMessages: 2,
	});

	// Short user message should be preserved exactly
	t.is(result.compressedMessages[0]?.content, shortContent);
});

test('compressMessages conservative mode compresses very long user messages (>1000 chars)', t => {
	const tokenizer = createMockTokenizer();
	const veryLongContent = 'B'.repeat(1200); // Exceeds CONSERVATIVE_USER_MESSAGE_THRESHOLD (1000)
	const messages: Message[] = [
		createUserMessage(veryLongContent),
		createUserMessage('Recent'),
		createAssistantMessage('Response'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'conservative',
		keepRecentMessages: 2,
	});

	// Very long message should be compressed even in conservative mode
	const firstMessage = result.compressedMessages[0];
	t.true((firstMessage?.content?.length ?? 0) < veryLongContent.length);
	t.true(
		(firstMessage?.content?.length ?? 0) <=
			COMPRESSION_CONSTANTS.CONSERVATIVE_TRUNCATION_LIMIT + 10,
	); // Allow some margin for "..."
});

test('compressMessages conservative mode preserves messages under 1000 chars', t => {
	const tokenizer = createMockTokenizer();
	const mediumContent = 'C'.repeat(800); // Under CONSERVATIVE_USER_MESSAGE_THRESHOLD
	const messages: Message[] = [
		createUserMessage(mediumContent),
		createUserMessage('Recent'),
		createAssistantMessage('Response'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'conservative',
		keepRecentMessages: 2,
	});

	// Medium length message should be preserved in conservative mode
	t.is(result.compressedMessages[0]?.content, mediumContent);
});

// ==================== System message handling ====================

test('compressMessages preserves system messages without compression', t => {
	const tokenizer = createMockTokenizer();
	const systemContent = 'You are a helpful assistant. '.repeat(100); // Long system message
	const messages: Message[] = [
		createSystemMessage(systemContent),
		createUserMessage('Hello'),
		createAssistantMessage('Hi there'),
	];

	const result = compressMessages(messages, tokenizer, {mode: 'aggressive'});

	// System message should be preserved exactly
	t.is(result.compressedMessages[0]?.content, systemContent);
	t.is(result.compressedMessages[0]?.role, 'system');
});

// ==================== Tool calls handling ====================

test('compressMessages preserves tool_calls in assistant messages', t => {
	const tokenizer = createMockTokenizer();
	const assistantWithTools: Message = {
		role: 'assistant',
		content: 'Let me read that file for you.',
		tool_calls: [
			{
				id: 'call_1',
				function: {
					name: 'read_file',
					arguments: {path: '/test.txt'},
				},
			},
		],
	};

	const messages: Message[] = [
		createUserMessage('Read test.txt'),
		assistantWithTools,
		createToolMessage('read_file', 'File contents'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'default',
		keepRecentMessages: 1,
	});

	// tool_calls should be preserved
	const assistantMsg = result.compressedMessages.find(
		m => m.role === 'assistant' && m.tool_calls,
	);
	t.truthy(assistantMsg?.tool_calls);
	t.is(assistantMsg?.tool_calls?.length, 1);
});

// ==================== Statistics tests ====================

test('compressMessages calculates reduction percentage correctly', t => {
	const tokenizer = createMockTokenizer();
	const longContent = 'X'.repeat(1000);
	const messages: Message[] = [
		createUserMessage(longContent),
		createUserMessage('Recent'),
		createAssistantMessage('Response'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'aggressive',
		keepRecentMessages: 2,
	});

	t.true(result.originalTokenCount > result.compressedTokenCount);
	t.true(result.reductionPercentage > 0);
	t.true(result.reductionPercentage <= 100);
});

test('compressMessages counts tool results correctly', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [
		createToolMessage('read_file', 'Content 1'),
		createToolMessage('write_file', 'Success'),
		createToolMessage('execute_bash', 'Output'),
		createUserMessage('Recent'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'default',
		keepRecentMessages: 1,
	});

	t.is(result.preservedInfo.toolResults, 3);
});

test('compressMessages counts file modifications correctly', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [
		createToolMessage('write_file', 'Written'),
		createToolMessage('edit_file', 'Edited'),
		createToolMessage('create_file', 'Created'),
		createToolMessage('read_file', 'Read'), // Not a modification
		createUserMessage('Recent'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'default',
		keepRecentMessages: 1,
	});

	t.is(result.preservedInfo.fileModifications, 3);
});

test('compressMessages counts recent messages correctly', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [
		createUserMessage('Old 1'),
		createUserMessage('Old 2'),
		createUserMessage('Recent 1'),
		createUserMessage('Recent 2'),
		createUserMessage('Recent 3'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'default',
		keepRecentMessages: 3,
	});

	t.is(result.preservedInfo.recentMessages, 3);
});

// ==================== Error handling in tool results ====================

test('compressMessages extracts error information from tool results', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [
		createToolMessage(
			'execute_bash',
			'Error: ENOENT\nFile: /missing.txt\nLine: 42\nNo such file or directory',
		),
		createUserMessage('Recent'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'default',
		keepRecentMessages: 1,
	});

	const toolMsg = result.compressedMessages[0];
	t.true(toolMsg?.content?.includes('Error') ?? false);
});

test('compressMessages detects success in tool results', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [
		createToolMessage('execute_bash', 'success'),
		createUserMessage('Recent'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'default',
		keepRecentMessages: 1,
	});

	const toolMsg = result.compressedMessages[0];
	t.true(toolMsg?.content?.includes('success') ?? false);
});

// ==================== keepRecentMessages option ====================

test('compressMessages respects custom keepRecentMessages value', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [
		createUserMessage('1'),
		createUserMessage('2'),
		createUserMessage('3'),
		createUserMessage('4'),
		createUserMessage('5'),
	];

	const result = compressMessages(messages, tokenizer, {
		mode: 'default',
		keepRecentMessages: 4,
	});

	// Last 4 messages should be preserved exactly
	t.is(result.compressedMessages[1]?.content, '2');
	t.is(result.compressedMessages[2]?.content, '3');
	t.is(result.compressedMessages[3]?.content, '4');
	t.is(result.compressedMessages[4]?.content, '5');
});

test('compressMessages uses default keepRecentMessages of 2', t => {
	const tokenizer = createMockTokenizer();
	const messages: Message[] = [
		createUserMessage('1'),
		createUserMessage('2'),
		createUserMessage('3'),
	];

	const result = compressMessages(messages, tokenizer, {mode: 'default'});

	// Last 2 messages should be preserved exactly
	t.is(result.compressedMessages[1]?.content, '2');
	t.is(result.compressedMessages[2]?.content, '3');
});

// ==================== Constants export test ====================

test('COMPRESSION_CONSTANTS exports expected values', t => {
	t.is(COMPRESSION_CONSTANTS.DEFAULT_KEEP_RECENT_MESSAGES, 2);
	t.is(COMPRESSION_CONSTANTS.USER_MESSAGE_COMPRESSION_THRESHOLD, 500);
	t.is(COMPRESSION_CONSTANTS.ASSISTANT_WITH_TOOLS_THRESHOLD, 300);
	t.is(COMPRESSION_CONSTANTS.AGGRESSIVE_TRUNCATION_LIMIT, 100);
	t.is(COMPRESSION_CONSTANTS.DEFAULT_TRUNCATION_LIMIT, 200);
	t.is(COMPRESSION_CONSTANTS.MIN_THRESHOLD_PERCENT, 50);
	t.is(COMPRESSION_CONSTANTS.MAX_THRESHOLD_PERCENT, 95);
	t.is(COMPRESSION_CONSTANTS.CONSERVATIVE_USER_MESSAGE_THRESHOLD, 1000);
	t.is(COMPRESSION_CONSTANTS.CONSERVATIVE_TRUNCATION_LIMIT, 500);
});
