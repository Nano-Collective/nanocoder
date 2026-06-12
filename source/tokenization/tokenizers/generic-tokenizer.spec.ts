/**
 * Tests for generic-tokenizer.ts
 */

import type {Message} from '@/types/core.js';
import test from 'ava';
import {GenericTokenizer} from './generic-tokenizer.js';

console.log(`\ngeneric-tokenizer.spec.ts`);

test('GenericTokenizer encodes text to a positive token count', t => {
	const tokenizer = new GenericTokenizer();
	const count = tokenizer.encode('Hello, world!');
	t.true(count > 0);
	tokenizer.free();
});

test('GenericTokenizer encodes empty string as zero', t => {
	const tokenizer = new GenericTokenizer();
	t.is(tokenizer.encode(''), 0);
	tokenizer.free();
});

test('GenericTokenizer is deterministic', t => {
	const tokenizer = new GenericTokenizer();
	const text = 'The quick brown fox jumps over the lazy dog';
	t.is(tokenizer.encode(text), tokenizer.encode(text));
	tokenizer.free();
});

test('GenericTokenizer counts longer text as more tokens', t => {
	const tokenizer = new GenericTokenizer();
	const short = tokenizer.encode('short');
	const long = tokenizer.encode('a much longer sentence with many more words in it');
	t.true(long > short);
	tokenizer.free();
});

test('GenericTokenizer counts message content plus role', t => {
	const tokenizer = new GenericTokenizer();
	const message: Message = {role: 'user', content: 'Hello, how are you?'};
	const count = tokenizer.countTokens(message);
	// content + role, both positive → strictly greater than content alone.
	t.true(count > tokenizer.encode(message.content ?? ''));
	tokenizer.free();
});

test('GenericTokenizer handles empty / missing content', t => {
	const tokenizer = new GenericTokenizer();
	t.true(tokenizer.countTokens({role: 'user', content: ''}) >= 0);
	t.true(tokenizer.countTokens({role: 'user'} as Message) >= 0);
	tokenizer.free();
});

test('GenericTokenizer beats char/4 on punctuation-dense input (real encoder)', t => {
	const tokenizer = new GenericTokenizer();
	// Skip the assertion if tiktoken could not load in this environment — the
	// tokenizer then legitimately degrades to char/4 and reports 'fallback'.
	if (tokenizer.getName() !== 'generic-o200k') {
		t.pass('tiktoken unavailable; running in char/4 degrade mode');
		return;
	}
	// JSON-ish text tokenizes denser than chars/4 because punctuation/symbols
	// each tend to be their own token.
	const code = '{"a":1,"b":[2,3],"c":{"d":true}}';
	const charOver4 = Math.ceil(code.length / 4);
	t.true(
		tokenizer.encode(code) > charOver4,
		'real BPE should exceed the char/4 estimate on dense punctuation',
	);
	tokenizer.free();
});

test('GenericTokenizer is safe to free twice', t => {
	const tokenizer = new GenericTokenizer();
	tokenizer.free();
	t.notThrows(() => tokenizer.free());
});
