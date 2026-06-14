import test from 'ava';
import {modelSupportsVision} from './vision-support.js';

test('anthropic provider is always vision-capable', t => {
	t.true(modelSupportsVision('anthropic', 'claude-opus-4-8'));
	t.true(modelSupportsVision('anthropic', 'some-future-model'));
});

test('google provider is always vision-capable', t => {
	t.true(modelSupportsVision('google', 'gemini-2.5-pro'));
	t.true(modelSupportsVision('google', 'anything'));
});

test('openai-compatible vision models are detected by name', t => {
	t.true(modelSupportsVision('openai-compatible', 'gpt-4o-2024-08-06'));
	t.true(modelSupportsVision('openai-compatible', 'llava:13b'));
	t.true(modelSupportsVision('openai-compatible', 'qwen2.5-vl-7b-instruct'));
	t.true(modelSupportsVision('openai-compatible', 'Pixtral-12B'));
});

test('openai-compatible text-only models are not flagged as vision-capable', t => {
	t.false(modelSupportsVision('openai-compatible', 'qwen2.5-coder:7b'));
	t.false(modelSupportsVision('openai-compatible', 'llama-3.1-8b-instruct'));
	t.false(modelSupportsVision('openai-compatible', 'deepseek-r1'));
});

test('matching is case-insensitive', t => {
	t.true(modelSupportsVision('openai-compatible', 'GPT-4O'));
	t.true(modelSupportsVision('github-copilot', 'Claude-3.5-Sonnet'));
});

test('undefined provider falls back to name heuristic', t => {
	t.true(modelSupportsVision(undefined, 'gpt-4o'));
	t.false(modelSupportsVision(undefined, 'mystery-model'));
});
