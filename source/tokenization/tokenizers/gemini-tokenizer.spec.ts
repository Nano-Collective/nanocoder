/**
 * Tests for gemini-tokenizer.ts
 */

import type {Message} from '@/types/core.js';
import test from 'ava';
import {GeminiTokenizer} from './gemini-tokenizer.js';

console.log(`\ngemini-tokenizer.spec.ts`);

test('GeminiTokenizer encodes simple text with char/4 heuristic', t => {
	const tokenizer = new GeminiTokenizer('gemini-1.5-pro');
	// 'Hello, world!' is 13 chars -> Math.ceil(13 / 4) = 4
	t.is(tokenizer.encode('Hello, world!'), 4);
});

test('GeminiTokenizer encodes empty string as 0', t => {
	const tokenizer = new GeminiTokenizer('gemini-1.5-pro');
	t.is(tokenizer.encode(''), 0);
});

test('GeminiTokenizer defaults to gemini when no model specified', t => {
	const tokenizer = new GeminiTokenizer();
	t.is(tokenizer.getName(), 'gemini-gemini');
});

test('GeminiTokenizer getName returns correct format', t => {
	const tokenizer = new GeminiTokenizer('gemini-1.5-flash');
	t.is(tokenizer.getName(), 'gemini-gemini-1.5-flash');
});

test('GeminiTokenizer countTokens includes message overhead', t => {
	const tokenizer = new GeminiTokenizer('gemini-1.5-pro');
	const message: Message = {
		role: 'user',
		content: 'Hi',
	};
	const count = tokenizer.countTokens(message);
	const contentOnly = tokenizer.encode('Hi');
	const roleOnly = tokenizer.encode('user');

	t.is(count, contentOnly + roleOnly + 4);
});

test('GeminiTokenizer countTokens handles empty content', t => {
	const tokenizer = new GeminiTokenizer('gemini-1.5-pro');
	const message: Message = {
		role: 'user',
		content: '',
	};
	const count = tokenizer.countTokens(message);

	// role 'user' (4 chars -> 1) + overhead 4 = 5
	t.is(count, 5);
});

test('GeminiTokenizer countTokens handles missing content', t => {
	const tokenizer = new GeminiTokenizer('gemini-1.5-pro');
	const message = {
		role: 'user',
	} as Message;

	t.true(tokenizer.countTokens(message) >= 0);
});
