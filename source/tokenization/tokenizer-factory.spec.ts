/**
 * Tests for tokenizer-factory.ts
 */

import test from 'ava';
import {createTokenizer} from './tokenizer-factory.js';
import {GenericTokenizer} from './tokenizers/generic-tokenizer.js';
import {LlamaTokenizer} from './tokenizers/llama-tokenizer.js';
import {OpenAITokenizer} from './tokenizers/openai-tokenizer.js';

console.log(`\ntokenizer-factory.spec.ts`);

// Test createTokenizer with OpenAI provider detection
test('createTokenizer detects OpenAI from provider name', t => {
	const tokenizer = createTokenizer('openai', 'custom-model');
	t.true(tokenizer instanceof OpenAITokenizer);
	t.is(tokenizer.getName(), 'openai-custom-model');
});

test('createTokenizer detects OpenAI from GPT model name', t => {
	const tokenizer = createTokenizer('custom', 'gpt-4-turbo');
	t.true(tokenizer instanceof OpenAITokenizer);
});

test('createTokenizer detects OpenAI from model name with openai keyword', t => {
	const tokenizer = createTokenizer('custom', 'openai-model');
	t.true(tokenizer instanceof OpenAITokenizer);
});

// Claude models have no published tokenizer, so they use the o200k_base proxy
test('createTokenizer uses the generic BPE tokenizer for an Anthropic provider', t => {
	const tokenizer = createTokenizer('anthropic', 'custom-model');
	t.true(tokenizer instanceof GenericTokenizer);
	t.is(tokenizer.getName(), 'generic-o200k');
});

test('createTokenizer uses the generic BPE tokenizer for a claude provider name', t => {
	const tokenizer = createTokenizer('claude-provider', 'model');
	t.true(tokenizer instanceof GenericTokenizer);
});

test('createTokenizer uses the generic BPE tokenizer for a claude model name', t => {
	const tokenizer = createTokenizer('custom', 'claude-sonnet-4-5');
	t.true(tokenizer instanceof GenericTokenizer);
});

test('createTokenizer keeps an Anthropic provider off the Llama tokenizer', t => {
	// "mistral" in the model id would otherwise select LlamaTokenizer.
	const tokenizer = createTokenizer('anthropic', 'mistral-large-on-claude');
	t.true(tokenizer instanceof GenericTokenizer);
});

// Test createTokenizer with Llama provider detection
test('createTokenizer detects Llama from llama model name', t => {
	const tokenizer = createTokenizer('custom', 'llama-3-8b');
	t.true(tokenizer instanceof LlamaTokenizer);
});

test('createTokenizer detects Llama from mistral model name', t => {
	const tokenizer = createTokenizer('custom', 'mistral-7b');
	t.true(tokenizer instanceof LlamaTokenizer);
});

test('createTokenizer detects Llama from qwen model name', t => {
	const tokenizer = createTokenizer('custom', 'qwen-2.5');
	t.true(tokenizer instanceof LlamaTokenizer);
});

test('createTokenizer detects Llama from gemma model name', t => {
	const tokenizer = createTokenizer('custom', 'gemma-2b');
	t.true(tokenizer instanceof LlamaTokenizer);
});

test('createTokenizer detects Llama from phi model name', t => {
	const tokenizer = createTokenizer('custom', 'phi-3');
	t.true(tokenizer instanceof LlamaTokenizer);
});

test('createTokenizer detects Llama from codellama model name', t => {
	const tokenizer = createTokenizer('custom', 'codellama-7b');
	t.true(tokenizer instanceof LlamaTokenizer);
});

test('createTokenizer detects Llama from deepseek model name', t => {
	const tokenizer = createTokenizer('custom', 'deepseek-coder');
	t.true(tokenizer instanceof LlamaTokenizer);
});

test('createTokenizer detects Llama from mixtral model name', t => {
	const tokenizer = createTokenizer('custom', 'mixtral-8x7b');
	t.true(tokenizer instanceof LlamaTokenizer);
});

test('createTokenizer detects Llama from ollama provider', t => {
	const tokenizer = createTokenizer('ollama', 'custom-model');
	t.true(tokenizer instanceof LlamaTokenizer);
});

test('createTokenizer detects Llama from llama.cpp provider', t => {
	const tokenizer = createTokenizer('llama.cpp', 'custom-model');
	t.true(tokenizer instanceof LlamaTokenizer);
});

test('createTokenizer detects Llama from local provider', t => {
	const tokenizer = createTokenizer('local', 'custom-model');
	t.true(tokenizer instanceof LlamaTokenizer);
});

// Test createTokenizer with fallback
test('createTokenizer returns GenericTokenizer for unknown provider', t => {
	const tokenizer = createTokenizer('unknown', 'unknown-model');
	t.true(tokenizer instanceof GenericTokenizer);
	if (tokenizer.free) {
		tokenizer.free();
	}
});

// Test cloud suffix stripping
test('createTokenizer strips :cloud suffix from model name', t => {
	const tokenizer = createTokenizer('ollama', 'llama-3:cloud');
	t.true(tokenizer instanceof LlamaTokenizer);
	t.is(tokenizer.getName(), 'llama-llama-3');
});

test('createTokenizer strips -cloud suffix from model name', t => {
	const tokenizer = createTokenizer('ollama', 'llama-3-cloud');
	t.true(tokenizer instanceof LlamaTokenizer);
	t.is(tokenizer.getName(), 'llama-llama-3');
});

// Test case insensitivity
test('createTokenizer is case insensitive for provider detection', t => {
	const tokenizer = createTokenizer('OPENAI', 'model');
	t.true(tokenizer instanceof OpenAITokenizer);
});

test('createTokenizer is case insensitive for model detection', t => {
	const tokenizer = createTokenizer('custom', 'GPT-4-TURBO');
	t.true(tokenizer instanceof OpenAITokenizer);
});
