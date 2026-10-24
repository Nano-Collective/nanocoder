import {createRequire} from 'node:module';
import test from 'ava';
import {createTokenizer} from './tokenizer-factory';

// Dedicated file so AVA's per-file worker gives us a clean module cache.
// Tests are serial and ordered: each step builds on the previous one.
const require = createRequire(import.meta.url);

const loaded = (pkg: RegExp): boolean =>
	Object.keys(require.cache).some(key => pkg.test(key));

const LLAMA = /[\\/]node_modules[\\/]llama-tokenizer-js[\\/]/;
const ANTHROPIC = /[\\/]node_modules[\\/]@anthropic-ai[\\/]tokenizer[\\/]/;
const TIKTOKEN = /[\\/]node_modules[\\/]tiktoken[\\/]/;

test.serial('importing the factory loads no tokenizer package', t => {
	t.false(loaded(LLAMA));
	t.false(loaded(ANTHROPIC));
	t.false(loaded(TIKTOKEN));
});

test.serial('llama tokenizer loads only its own package, on first encode', t => {
	const tokenizer = createTokenizer('ollama', 'llama3');
	t.false(loaded(LLAMA), 'not loaded at construction');

	tokenizer.encode('hello world');
	t.true(loaded(LLAMA), 'loaded on first encode');
	t.false(loaded(ANTHROPIC));
	t.false(loaded(TIKTOKEN));
});

test.serial('anthropic tokenizer loads its package on first encode', t => {
	const tokenizer = createTokenizer('anthropic', 'claude-3');
	t.false(loaded(ANTHROPIC), 'not loaded at construction');

	tokenizer.encode('hello world');
	t.true(loaded(ANTHROPIC), 'loaded on first encode');
});