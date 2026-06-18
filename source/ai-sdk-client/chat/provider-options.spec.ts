import test from 'ava';
import type {AIProviderConfig, OpenRouterParameters} from '@/types/index';
import {buildProviderOptions} from './provider-options.js';

function makeProvider(
	overrides: Partial<AIProviderConfig> = {},
): AIProviderConfig {
	return {
		name: 'OpenRouter',
		type: 'openai-compatible',
		models: ['x-ai/grok-4'],
		config: {
			baseURL: 'https://openrouter.ai/api/v1',
			apiKey: 'test-key',
		},
		...overrides,
	};
}

function withOpenRouter(
	openrouter: OpenRouterParameters,
	overrides: Partial<AIProviderConfig> = {},
): AIProviderConfig {
	return makeProvider({openrouter, ...overrides});
}

test('returns Ollama num_ctx provider options when a context limit is resolved', async t => {
	const result = await buildProviderOptions(
		makeProvider({
			name: 'Ollama',
			config: {baseURL: 'http://localhost:11434/v1', apiKey: 'test-key'},
			contextWindow: 32768,
		}),
		'llama3.1',
		'system prompt',
		undefined,
	);
	t.deepEqual(result, {
		Ollama: {
			options: {
				num_ctx: 32768,
			},
		},
	});
});

test('returns undefined for OpenRouter with no openrouter config and no reasoning shortcut', async t => {
	const result = await buildProviderOptions(
		makeProvider(),
		'x-ai/grok-4',
		'system prompt',
		{temperature: 0.7},
	);
	t.is(result, undefined);
});

test('chatgpt-codex always returns providerOptions.openai with defaults', async t => {
	const result = await buildProviderOptions(
		makeProvider({name: 'codex', sdkProvider: 'chatgpt-codex'}),
		'gpt-5',
		'hello system',
		undefined,
	);
	t.deepEqual(result, {
		openai: {
			instructions: 'hello system',
			store: false,
			reasoningEffort: 'medium',
			reasoningSummary: 'auto',
		},
	});
});

test('chatgpt-codex honours overridden reasoningEffort and reasoningSummary', async t => {
	const result = await buildProviderOptions(
		makeProvider({name: 'codex', sdkProvider: 'chatgpt-codex'}),
		'gpt-5',
		'hello',
		{reasoningEffort: 'high', reasoningSummary: 'detailed'},
	);
	t.deepEqual(result, {
		openai: {
			instructions: 'hello',
			store: false,
			reasoningEffort: 'high',
			reasoningSummary: 'detailed',
		},
	});
});

test('OpenRouter forwards provider routing block', async t => {
	const provider = withOpenRouter({
		provider: {
			order: ['Anthropic', 'OpenAI'],
			allow_fallbacks: false,
			sort: 'price',
		},
	});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', undefined);
	t.deepEqual(result, {
		openrouter: {
			provider: {
				order: ['Anthropic', 'OpenAI'],
				allow_fallbacks: false,
				sort: 'price',
			},
		},
	});
});

test('OpenRouter accepts object-form sort for cross-model partitioning', async t => {
	const provider = withOpenRouter({
		provider: {sort: {by: 'price', partition: 'model'}},
	});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', undefined);
	t.deepEqual(result, {
		openrouter: {
			provider: {sort: {by: 'price', partition: 'model'}},
		},
	});
});

test('OpenRouter forwards plugins and fallback models list', async t => {
	const provider = withOpenRouter({
		plugins: [{id: 'context-compression', engine: 'middle-out'}],
		models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o'],
	});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', undefined);
	t.deepEqual(result, {
		openrouter: {
			plugins: [{id: 'context-compression', engine: 'middle-out'}],
			models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o'],
		},
	});
});

test('OpenRouter forwards service_tier=flex', async t => {
	const provider = withOpenRouter({service_tier: 'flex'});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', undefined);
	t.deepEqual(result, {openrouter: {service_tier: 'flex'}});
});

test('OpenRouter forwards service_tier=priority', async t => {
	const provider = withOpenRouter({service_tier: 'priority'});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', undefined);
	t.deepEqual(result, {openrouter: {service_tier: 'priority'}});
});

test('OpenRouter forwards route and user', async t => {
	const provider = withOpenRouter({route: 'fallback', user: 'user-123'});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', undefined);
	t.deepEqual(result, {
		openrouter: {route: 'fallback', user: 'user-123'},
	});
});

test('OpenRouter forwards extended reasoning block with xhigh and exclude', async t => {
	const provider = withOpenRouter({
		reasoning: {effort: 'xhigh', max_tokens: 12000, exclude: false},
	});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', undefined);
	t.deepEqual(result, {
		openrouter: {
			reasoning: {effort: 'xhigh', max_tokens: 12000, exclude: false},
		},
	});
});

test('OpenRouter maps tune-level reasoningEffort to reasoning.effort', async t => {
	const result = await buildProviderOptions(makeProvider(), 'x-ai/grok-4', '', {
		reasoningEffort: 'high',
	});
	t.deepEqual(result, {openrouter: {reasoning: {effort: 'high'}}});
});

test('OpenRouter passes minimal reasoningEffort straight through', async t => {
	const result = await buildProviderOptions(makeProvider(), 'x-ai/grok-4', '', {
		reasoningEffort: 'minimal',
	});
	t.deepEqual(result, {openrouter: {reasoning: {effort: 'minimal'}}});
});

test('OpenRouter merges tune shortcut effort with provider-config reasoning block', async t => {
	const provider = withOpenRouter({
		reasoning: {max_tokens: 8000, exclude: true},
	});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', {
		reasoningEffort: 'medium',
	});
	t.deepEqual(result, {
		openrouter: {
			reasoning: {effort: 'medium', max_tokens: 8000, exclude: true},
		},
	});
});

test('provider-config reasoning.effort wins over tune shortcut', async t => {
	const provider = withOpenRouter({reasoning: {effort: 'high'}});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', {
		reasoningEffort: 'low',
	});
	t.deepEqual(result, {openrouter: {reasoning: {effort: 'high'}}});
});

test('OpenRouter routing extras (zdr, max_price, latency thresholds) flow through', async t => {
	const provider = withOpenRouter({
		provider: {
			zdr: true,
			enforce_distillable_text: true,
			max_price: {prompt: 0.5, completion: 1.5},
			preferred_min_throughput: {p90: 30},
			preferred_max_latency: 2000,
		},
	});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', undefined);
	t.deepEqual(result, {
		openrouter: {
			provider: {
				zdr: true,
				enforce_distillable_text: true,
				max_price: {prompt: 0.5, completion: 1.5},
				preferred_min_throughput: {p90: 30},
				preferred_max_latency: 2000,
			},
		},
	});
});

test('OpenRouter detection is case-insensitive on provider name', async t => {
	const provider = withOpenRouter(
		{service_tier: 'flex'},
		{name: 'openrouter'},
	);
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', undefined);
	t.deepEqual(result, {openrouter: {service_tier: 'flex'}});
});

test('OpenRouter combines provider, reasoning, plugins, models, service_tier', async t => {
	const provider = withOpenRouter({
		provider: {sort: 'throughput'},
		plugins: [{id: 'web'}],
		models: ['openai/gpt-4o'],
		service_tier: 'flex',
	});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', {reasoningEffort: 'high'});
	t.deepEqual(result, {
		openrouter: {
			provider: {sort: 'throughput'},
			reasoning: {effort: 'high'},
			plugins: [{id: 'web'}],
			models: ['openai/gpt-4o'],
			service_tier: 'flex',
		},
	});
});

test('OpenRouter ignores chatgpt-codex-only fields without dropping requests', async t => {
	const result = await buildProviderOptions(makeProvider(), 'x-ai/grok-4', '', {
		reasoningSummary: 'detailed',
	});
	t.is(result, undefined);
});

test('OpenRouter forwards extraBody pass-through fields', async t => {
	const provider = withOpenRouter({
		extraBody: {usage: {include: true}, debug: {echo_upstream_body: true}},
	});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', undefined);
	t.deepEqual(result, {
		openrouter: {
			usage: {include: true},
			debug: {echo_upstream_body: true},
		},
	});
});

test('OpenRouter extraBody is overridden by typed fields on key collision', async t => {
	const provider = withOpenRouter({
		service_tier: 'flex',
		extraBody: {service_tier: 'priority', custom: 'kept'},
	});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', undefined);
	t.deepEqual(result, {
		openrouter: {service_tier: 'flex', custom: 'kept'},
	});
});

test('OpenRouter extraBody alone is enough to emit providerOptions', async t => {
	const provider = withOpenRouter({
		extraBody: {experimental_flag: true},
	});
	const result = await buildProviderOptions(provider, 'x-ai/grok-4', '', undefined);
	t.deepEqual(result, {openrouter: {experimental_flag: true}});
});
