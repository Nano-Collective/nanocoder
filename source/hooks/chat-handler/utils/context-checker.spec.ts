import test from 'ava';
import {checkContextUsage} from './context-checker.js';
import type {Message} from '@/types/core';

// Note: This is a simple smoke test since checkContextUsage has many dependencies
// Full integration testing would require mocking getModelContextLimit, tokenizer, etc.

test('checkContextUsage - does not throw on empty messages', async t => {
	const messages: Message[] = [];
	const systemMessage: Message = {role: 'system', content: 'test'};
	const addToChatQueue = () => {};

	await t.notThrowsAsync(async () => {
		await checkContextUsage(
			messages,
			systemMessage,
			'test-provider',
			'test-model',
			addToChatQueue,
			() => 1,
		);
	});
});

test('checkContextUsage - handles unknown model gracefully', async t => {
	const messages: Message[] = [{role: 'user', content: 'test'}];
	const systemMessage: Message = {role: 'system', content: 'test'};
	const addToChatQueue = () => {};

	await t.notThrowsAsync(async () => {
		await checkContextUsage(
			messages,
			systemMessage,
			'unknown-provider',
			'unknown-model',
			addToChatQueue,
			() => 1,
		);
	});
});

test('checkContextUsage - handles errors silently', async t => {
	const messages: Message[] = [{role: 'user', content: 'test'}];
	const systemMessage: Message = {role: 'system', content: 'test'};
	const addToChatQueue = () => {
		throw new Error('Test error');
	};

	// Should not throw even if addToChatQueue throws
	await t.notThrowsAsync(async () => {
		await checkContextUsage(
			messages,
			systemMessage,
			'test-provider',
			'test-model',
			addToChatQueue,
			() => 1,
		);
	});
});
