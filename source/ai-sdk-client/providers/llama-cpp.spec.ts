import test from 'ava';
import {isLlamaCppProvider} from './llama-cpp.js';

test('isLlamaCppProvider returns true for exact match with dots', t => {
	t.true(isLlamaCppProvider('llama.cpp'));
});

test('isLlamaCppProvider returns true for hyphen variant', t => {
	t.true(isLlamaCppProvider('llama-cpp'));
});

test('isLlamaCppProvider returns true for underscore variant', t => {
	t.true(isLlamaCppProvider('llama_cpp'));
});

test('isLlamaCppProvider returns true for no separator', t => {
	t.true(isLlamaCppProvider('llamacpp'));
});

test('isLlamaCppProvider returns true for uppercase variants', t => {
	t.true(isLlamaCppProvider('LLAMA.CPP'));
	t.true(isLlamaCppProvider('LLAMA-CPP'));
	t.true(isLlamaCppProvider('LLAMACPP'));
});

test('isLlamaCppProvider returns true for mixed case variants', t => {
	t.true(isLlamaCppProvider('Llama.Cpp'));
	t.true(isLlamaCppProvider('LLaMa-CpP'));
});

test('isLlamaCppProvider returns false for non-matching names', t => {
	t.false(isLlamaCppProvider('openrouter'));
	t.false(isLlamaCppProvider('ollama'));
	t.false(isLlamaCppProvider('vllm'));
	t.false(isLlamaCppProvider('openai'));
	t.false(isLlamaCppProvider('llama'));
	t.false(isLlamaCppProvider('cpp'));
	t.false(isLlamaCppProvider('llama.cpp-server'));
	t.false(isLlamaCppProvider('my-llama.cpp'));
});
