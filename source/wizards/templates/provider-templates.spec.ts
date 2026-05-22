import test from 'ava';
import {PROVIDER_TEMPLATES} from './provider-templates.js';

test('ollama template: single model', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'ollama');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'ollama',
		baseUrl: 'http://localhost:11434/v1',
		model: 'llama2',
	});

	t.deepEqual(config.models, ['llama2']);
});

test('ollama template: multiple comma-separated models', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'ollama');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'ollama',
		baseUrl: 'http://localhost:11434/v1',
		model: 'llama2, codellama, mistral',
	});

	t.deepEqual(config.models, ['llama2', 'codellama', 'mistral']);
});

test('ollama template: handles extra whitespace', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'ollama');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'ollama',
		baseUrl: 'http://localhost:11434/v1',
		model: '  llama2  ,  codellama  ,  mistral  ',
	});

	t.deepEqual(config.models, ['llama2', 'codellama', 'mistral']);
});

test('ollama template: filters empty strings', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'ollama');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'ollama',
		baseUrl: 'http://localhost:11434/v1',
		model: 'llama2,,codellama,',
	});

	t.deepEqual(config.models, ['llama2', 'codellama']);
});

test('mlx-server template: single model', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'mlx-server');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'mlx-server',
		baseUrl: 'http://localhost:8080/v1',
		model: 'mlx-community/Qwen2.5-Coder-32B-Instruct-4bit',
	});

	t.deepEqual(config.models, [
		'mlx-community/Qwen2.5-Coder-32B-Instruct-4bit',
	]);
	t.is(config.name, 'mlx-server');
	t.is(config.baseUrl, 'http://localhost:8080/v1');
});

test('mlx-server template: multiple comma-separated models', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'mlx-server');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'mlx-server',
		baseUrl: 'http://localhost:8080/v1',
		model: 'mlx-community/Qwen2.5-Coder-32B-Instruct-4bit, mlx-community/Llama-3.3-70B-Instruct-4bit',
	});

	t.deepEqual(config.models, [
		'mlx-community/Qwen2.5-Coder-32B-Instruct-4bit',
		'mlx-community/Llama-3.3-70B-Instruct-4bit',
	]);
});

test('mlx-server template: uses default name when empty', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'mlx-server');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: '',
		baseUrl: 'http://localhost:8080/v1',
		model: 'some-model',
	});

	t.is(config.name, 'MLX Server');
});

test('mlx-server template: uses default baseUrl when empty', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'mlx-server');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'mlx-server',
		baseUrl: '',
		model: 'some-model',
	});

	t.is(config.baseUrl, 'http://localhost:8080/v1');
});

test('custom template: single model', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'custom');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'custom-provider',
		baseUrl: 'http://localhost:8000/v1',
		model: 'my-model',
	});

	t.deepEqual(config.models, ['my-model']);
});

test('custom template: multiple comma-separated models', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'custom');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'custom-provider',
		baseUrl: 'http://localhost:8000/v1',
		model: 'model1, model2, model3',
	});

	t.deepEqual(config.models, ['model1', 'model2', 'model3']);
});

test('openrouter template: single model', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'openrouter');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'OpenRouter',
		apiKey: 'test-key',
		model: 'z-ai/glm-4.7',
	});

	t.deepEqual(config.models, ['z-ai/glm-4.7']);
});

test('openrouter template: multiple comma-separated models', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'openrouter');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'OpenRouter',
		apiKey: 'test-key',
		model: 'z-ai/glm-4.7, anthropic/claude-3-opus, openai/gpt-4',
	});

	t.deepEqual(config.models, [
		'z-ai/glm-4.7',
		'anthropic/claude-3-opus',
		'openai/gpt-4',
	]);
});

test('openrouter template: no openrouter block when optional fields are blank', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'openrouter');
	const config = template!.buildConfig({
		providerName: 'OpenRouter',
		apiKey: 'test-key',
		model: 'z-ai/glm-4.7',
		serviceTier: '',
		reasoningEffort: '',
		sortBy: '',
	});
	t.is(config.openrouter, undefined);
});

test('openrouter template: populates openrouter block from optional fields', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'openrouter');
	const config = template!.buildConfig({
		providerName: 'OpenRouter',
		apiKey: 'test-key',
		model: 'z-ai/glm-4.7',
		serviceTier: 'flex',
		reasoningEffort: 'high',
		sortBy: 'price',
	});
	t.deepEqual(config.openrouter, {
		service_tier: 'flex',
		reasoning: {effort: 'high'},
		provider: {sort: 'price'},
	});
});

test('openrouter template: boolean fields are typed and accepted as "true"/"false"', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'openrouter');
	const allowFallbacks = template!.fields.find(f => f.name === 'allowFallbacks');
	const zdr = template!.fields.find(f => f.name === 'zdr');

	t.is(allowFallbacks?.type, 'boolean');
	t.is(zdr?.type, 'boolean');

	const config = template!.buildConfig({
		providerName: 'OpenRouter',
		apiKey: 'k',
		model: 'x/y',
		allowFallbacks: 'true',
		zdr: 'false',
	});
	t.deepEqual(config.openrouter, {
		provider: {allow_fallbacks: true, zdr: false},
	});
});

test('openrouter template: boolean fields skipped (blank) emit no entry', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'openrouter');
	const config = template!.buildConfig({
		providerName: 'OpenRouter',
		apiKey: 'k',
		model: 'x/y',
		allowFallbacks: '',
		zdr: '',
	});
	t.is(config.openrouter, undefined);
});

test('openrouter template: array fields parse comma-separated input', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'openrouter');
	const providerOrder = template!.fields.find(f => f.name === 'providerOrder');
	const fallbackModels = template!.fields.find(
		f => f.name === 'fallbackModels',
	);

	t.is(providerOrder?.type, 'array');
	t.is(fallbackModels?.type, 'array');

	const config = template!.buildConfig({
		providerName: 'OpenRouter',
		apiKey: 'k',
		model: 'x/y',
		providerOrder: 'Anthropic, OpenAI ,  ',
		fallbackModels: 'openai/gpt-4o, anthropic/claude-3.5-sonnet',
	});
	t.deepEqual(config.openrouter, {
		provider: {order: ['Anthropic', 'OpenAI']},
		models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet'],
	});
});

test('openrouter template: array fields with only whitespace produce no entry', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'openrouter');
	const config = template!.buildConfig({
		providerName: 'OpenRouter',
		apiKey: 'k',
		model: 'x/y',
		providerOrder: ' , , ',
		fallbackModels: '',
	});
	t.is(config.openrouter, undefined);
});

test('openrouter template: combines string, boolean, and array answers into a single block', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'openrouter');
	const config = template!.buildConfig({
		providerName: 'OpenRouter',
		apiKey: 'k',
		model: 'x/y',
		serviceTier: 'flex',
		reasoningEffort: 'high',
		sortBy: 'price',
		providerOrder: 'Anthropic, OpenAI',
		allowFallbacks: 'true',
		zdr: 'true',
		fallbackModels: 'openai/gpt-4o',
	});
	t.deepEqual(config.openrouter, {
		provider: {
			sort: 'price',
			allow_fallbacks: true,
			zdr: true,
			order: ['Anthropic', 'OpenAI'],
		},
		reasoning: {effort: 'high'},
		service_tier: 'flex',
		models: ['openai/gpt-4o'],
	});
});

test('openrouter template: validators reject invalid optional inputs', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'openrouter');
	const tier = template!.fields.find(f => f.name === 'serviceTier');
	const effort = template!.fields.find(f => f.name === 'reasoningEffort');
	const sort = template!.fields.find(f => f.name === 'sortBy');

	t.is(tier?.validator?.(''), undefined);
	t.is(tier?.validator?.('flex'), undefined);
	t.regex(tier?.validator?.('auto') ?? '', /Service tier/);

	t.is(effort?.validator?.('xhigh'), undefined);
	t.regex(effort?.validator?.('extreme') ?? '', /Reasoning effort/);

	t.is(sort?.validator?.('throughput'), undefined);
	t.regex(sort?.validator?.('cheapest') ?? '', /Sort must be one of/);
});

test('openai template: preserves organizationId', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'openai');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'openai',
		apiKey: 'test-key',
		model: 'gpt-5-codex',
		organizationId: 'org-123',
	});

	t.is(config.organizationId, 'org-123');
	t.deepEqual(config.models, ['gpt-5-codex']);
});

test('openai template: handles multiple models', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'openai');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'openai',
		apiKey: 'test-key',
		model: 'gpt-5-codex, gpt-4-turbo, gpt-4',
	});

	t.deepEqual(config.models, ['gpt-5-codex', 'gpt-4-turbo', 'gpt-4']);
});

test('custom template: includes timeout', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'custom');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'custom-provider',
		baseUrl: 'http://localhost:8000/v1',
		model: 'my-model',
		timeout: '60000',
	});

	t.is(config.timeout, 60000);
});

test('gemini template: sets sdkProvider to google', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'gemini');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'Gemini',
		apiKey: 'test-key',
		model: 'gemini-2.5-flash',
	});

	t.is(config.sdkProvider, 'google');
	t.is(config.name, 'Gemini');
	t.deepEqual(config.models, ['gemini-2.5-flash']);
});

test('gemini template: handles multiple models', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'gemini');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'Gemini',
		apiKey: 'test-key',
		model: 'gemini-3-flash-preview, gemini-3-pro-preview',
	});

	t.is(config.sdkProvider, 'google');
	t.deepEqual(config.models, ['gemini-3-flash-preview', 'gemini-3-pro-preview']);
});

test('gemini template: uses default provider name', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'gemini');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: '',
		apiKey: 'test-key',
		model: 'gemini-2.5-flash',
	});

	t.is(config.name, 'Google Gemini');
});

test('gemini template: includes baseUrl for documentation', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'gemini');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: 'Gemini',
		apiKey: 'test-key',
		model: 'gemini-2.5-flash',
	});

	t.is(config.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
});

test('github-copilot template: sets sdkProvider and defaults', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'github-copilot');
	t.truthy(template);

	const config = template!.buildConfig({
		providerName: '',
		model: 'gpt-4.1, gpt-5.3-codex, claude-sonnet-4.6',
	});

	t.is(config.name, 'GitHub Copilot');
	t.is(config.sdkProvider, 'github-copilot');
	t.is(config.baseUrl, 'https://api.githubcopilot.com');
	t.deepEqual(config.models, ['gpt-4.1', 'gpt-5.3-codex', 'claude-sonnet-4.6']);
});

// ============================================================================
// Tests for template ID vs sdkProvider collision prevention
// Providers that use sdkProvider: 'anthropic' (like MiniMax, Kimi) must not
// be confused with the Anthropic Claude template during edit lookups.
// ============================================================================

test('minimax-coding template: sets sdkProvider to anthropic with minimax baseUrl', t => {
	const template = PROVIDER_TEMPLATES.find(t => t.id === 'minimax-coding');
	t.truthy(template);

	const config = template!.buildConfig({
		apiKey: 'test-key',
		model: 'MiniMax-M2.7',
		providerName: '',
	});

	t.is(config.sdkProvider, 'anthropic');
	t.is(config.baseUrl, 'https://api.minimax.io/anthropic/v1');
	t.is(config.name, 'MiniMax Coding');
	t.deepEqual(config.models, ['MiniMax-M2.7']);
});

test('no template id matches an sdkProvider value used by a different template', t => {
	// This guards against the edit-lookup bug where matching by sdkProvider
	// would resolve to the wrong template (e.g. MiniMax -> Anthropic Claude)
	const sdkProviderValues = new Map<string, string[]>();

	for (const template of PROVIDER_TEMPLATES) {
		const config = template.buildConfig({
			providerName: 'test',
			baseUrl: 'http://test',
			apiKey: 'test',
			model: 'test',
		});

		if (config.sdkProvider) {
			if (!sdkProviderValues.has(config.sdkProvider)) {
				sdkProviderValues.set(config.sdkProvider, []);
			}
			sdkProviderValues.get(config.sdkProvider)!.push(template.id);
		}
	}

	// For each sdkProvider value used by multiple templates, verify
	// that at most one template has that value as its id
	for (const [sdkProvider, templateIds] of sdkProviderValues) {
		const matchingTemplates = templateIds.filter(id => id === sdkProvider);
		t.true(
			matchingTemplates.length <= 1,
			`sdkProvider '${sdkProvider}' matches multiple template ids: ${matchingTemplates.join(', ')}`,
		);
	}
});

test('anthropic, minimax, and kimi templates set expected sdkProvider values', t => {
	const anthropic = PROVIDER_TEMPLATES.find(t => t.id === 'anthropic');
	const minimax = PROVIDER_TEMPLATES.find(t => t.id === 'minimax-coding');
	const kimi = PROVIDER_TEMPLATES.find(t => t.id === 'kimi-code');

	t.truthy(anthropic);
	t.truthy(minimax);
	t.truthy(kimi);

	t.is(
		anthropic!.buildConfig({
			providerName: 'Anthropic Claude',
			apiKey: 'test-key',
			model: 'claude-sonnet-4-5-20250929',
		}).sdkProvider,
		'anthropic',
	);
	t.is(
		minimax!.buildConfig({
			providerName: 'MiniMax Coding',
			apiKey: 'test-key',
			model: 'MiniMax-M2.7',
		}).sdkProvider,
		'anthropic',
	);
	t.is(
		kimi!.buildConfig({
			providerName: 'Kimi Code',
			apiKey: 'test-key',
			model: 'kimi-for-coding',
		}).sdkProvider,
		'anthropic',
	);
});
