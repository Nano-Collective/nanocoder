import test from 'ava';
import {isOllamaProvider} from './ollama.js';

test('isOllamaProvider returns true for exact match', t => {
	t.true(isOllamaProvider('ollama'));
});

test('isOllamaProvider returns true for uppercase', t => {
	t.true(isOllamaProvider('OLLAMA'));
});

test('isOllamaProvider returns true for mixed case', t => {
	t.true(isOllamaProvider('Ollama'));
	t.true(isOllamaProvider('OlLaMa'));
});

test('isOllamaProvider returns false for non-matching names', t => {
	t.false(isOllamaProvider('openrouter'));
	t.false(isOllamaProvider('vllm'));
	t.false(isOllamaProvider('llama.cpp'));
	t.false(isOllamaProvider('openai'));
	t.false(isOllamaProvider('ollama-something'));
	t.false(isOllamaProvider('my-ollama'));
});
