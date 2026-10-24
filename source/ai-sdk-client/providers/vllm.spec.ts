import test from 'ava';
import {isVLLMProvider} from './vllm.js';

test('isVLLMProvider returns true for exact match lowercase', t => {
	t.true(isVLLMProvider('vllm'));
});

test('isVLLMProvider returns true for uppercase', t => {
	t.true(isVLLMProvider('VLLM'));
});

test('isVLLMProvider returns true for mixed case', t => {
	t.true(isVLLMProvider('vLLM'));
	t.true(isVLLMProvider('VlLm'));
});

test('isVLLMProvider returns false for non-matching names', t => {
	t.false(isVLLMProvider('openrouter'));
	t.false(isVLLMProvider('ollama'));
	t.false(isVLLMProvider('llama.cpp'));
	t.false(isVLLMProvider('openai'));
	t.false(isVLLMProvider('vllm-server'));
	t.false(isVLLMProvider('my-vllm'));
});
