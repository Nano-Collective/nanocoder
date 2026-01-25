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

	t.is(config.name, 'Gemini');
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
