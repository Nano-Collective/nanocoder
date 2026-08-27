import test from 'ava';
import {
	autoSelectSimpleModel,
	classifyTurnComplexity,
} from './smart-router.js';

// ── classifyTurnComplexity ──────────────────────────────────────────

test('returns simple for short, trivial prompts', t => {
	t.is(classifyTurnComplexity('view file package.json'), 'simple');
	t.is(classifyTurnComplexity('show status'), 'simple');
	t.is(classifyTurnComplexity('what is line 5?'), 'simple');
});

test('returns simple for empty or whitespace-only input', t => {
	t.is(classifyTurnComplexity(''), 'simple');
	t.is(classifyTurnComplexity('   '), 'simple');
});

test('returns strong for a single code block', t => {
	const prompt = 'Fix this:\n```js\nconsole.log("hello");\n```';
	t.is(classifyTurnComplexity(prompt), 'strong');
});

test('returns strong for multiple code blocks', t => {
	const prompt = [
		'Compare these two:',
		'```js',
		'const a = 1;',
		'```',
		'and',
		'```js',
		'const b = 2;',
		'```',
	].join('\n');
	t.is(classifyTurnComplexity(prompt), 'strong');
});

test('returns strong for complex keywords', t => {
	t.is(
		classifyTurnComplexity('Refactor authentication flow in login.tsx'),
		'strong',
	);
	t.is(
		classifyTurnComplexity('Architect a new state management system'),
		'strong',
	);
});

test('returns strong when no keyword matches (fail-safe default)', t => {
	// "hello world" has no trivial or complex keywords — should default to strong
	t.is(classifyTurnComplexity('hello world'), 'strong');
});

test('supports custom complex keywords', t => {
	// "deploy" is NOT in the default complex list
	t.is(classifyTurnComplexity('deploy to staging'), 'strong'); // no keyword → default strong
	t.is(
		classifyTurnComplexity('deploy to staging', {
			customComplexKeywords: ['deploy'],
		}),
		'strong',
	);
});

test('supports custom trivial keywords', t => {
	// "inspect" is NOT in the default trivial list, so without custom it defaults to strong
	t.is(classifyTurnComplexity('inspect log file'), 'strong');
	t.is(
		classifyTurnComplexity('inspect log file', {
			customTrivialKeywords: ['inspect'],
		}),
		'simple',
	);
});

test('respects word boundaries — does not match substrings', t => {
	// "cat" is a trivial keyword, but "categories" should NOT trigger it.
	// "categories" alone has no keyword match → defaults to strong.
	t.is(classifyTurnComplexity('categories'), 'strong');
	// But "cat the file" should match the trivial keyword "cat".
	t.is(classifyTurnComplexity('cat the file'), 'simple');
});

test('respects threshold settings', t => {
	const text = 'a'.repeat(150); // 150 chars, no keywords
	t.is(classifyTurnComplexity(text, {threshold: 'high'}), 'strong'); // within 300 limit but no keyword → strong
	t.is(classifyTurnComplexity(text, {threshold: 'low'}), 'strong'); // exceeds 100 limit → strong
});

test('long prompts are always strong regardless of keywords', t => {
	const longTrivial = `view ${'a'.repeat(250)}`;
	t.is(classifyTurnComplexity(longTrivial), 'strong');
});

// ── autoSelectSimpleModel ───────────────────────────────────────────

test('autoSelectSimpleModel finds lightweight models', t => {
	const models = [
		'gpt-4o',
		'gpt-4o-mini',
		'claude-3-5-sonnet-20241022',
		'claude-3-5-haiku-20241022',
	];
	t.is(autoSelectSimpleModel(models), 'gpt-4o-mini');
});

test('autoSelectSimpleModel finds local lightweight models', t => {
	const ollamaModels = ['llama3.3:70b', 'qwen2.5-coder:7b'];
	t.is(autoSelectSimpleModel(ollamaModels), 'qwen2.5-coder:7b');
});

test('autoSelectSimpleModel falls back to first model when no pattern matches', t => {
	const models = ['custom-model-a', 'custom-model-b'];
	t.is(autoSelectSimpleModel(models), 'custom-model-a');
});

test('autoSelectSimpleModel returns undefined for empty list', t => {
	t.is(autoSelectSimpleModel([]), undefined);
});

test('autoSelectSimpleModel supports custom patterns', t => {
	const models = ['model-v1-custom-fast', 'model-v1-standard'];
	t.is(
		autoSelectSimpleModel(models, {
			customLightweightPatterns: [/fast/i],
		}),
		'model-v1-custom-fast',
	);
});
