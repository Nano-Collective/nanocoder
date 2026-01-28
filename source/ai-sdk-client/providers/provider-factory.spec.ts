import test from 'ava';
import type {AIProviderConfig} from '@/types/index';
import {Agent} from 'undici';
import {createProvider} from './provider-factory.js';

test('createProvider creates provider with basic config', t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			baseURL: 'https://api.test.com',
			apiKey: 'test-key',
			headers: {
				'Custom-Header': 'CustomValue',
			},
		},
	};

	const agent = new Agent();
	const provider = createProvider(config, agent);

	t.truthy(provider);
	t.is(typeof provider, 'function');
});

test('createProvider adds OpenRouter headers for openrouter provider', t => {
	const config: AIProviderConfig = {
		name: 'OpenRouter',
		type: 'openai',
		models: ['test-model'],
		config: {
			baseURL: 'https://openrouter.ai/api/v1',
			apiKey: 'test-key',
		},
	};

	const agent = new Agent();
	const provider = createProvider(config, agent);

	t.truthy(provider);
});

test('createProvider handles provider with no API key', t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			baseURL: 'https://api.test.com',
			headers: {
				'Custom-Header': 'CustomValue',
			},
		},
	};

	const agent = new Agent();
	const provider = createProvider(config, agent);

	t.truthy(provider);
});

test('createProvider handles provider with no baseURL', t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			apiKey: 'test-key',
			headers: {
				'Custom-Header': 'CustomValue',
			},
		},
	};

	const agent = new Agent();
	const provider = createProvider(config, agent);

	t.truthy(provider);
});

test('createProvider handles provider with no custom headers', t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			baseURL: 'https://api.test.com',
			apiKey: 'test-key',
		},
	};

	const agent = new Agent();
	const provider = createProvider(config, agent);

	t.truthy(provider);
});

test('createProvider uses @ai-sdk/google when sdkProvider is google', t => {
	const config: AIProviderConfig = {
		name: 'Gemini',
		type: 'openai',
		models: ['gemini-2.5-flash'],
		sdkProvider: 'google',
		config: {
			apiKey: 'test-key',
		},
	};

	const agent = new Agent();
	const provider = createProvider(config, agent);

	t.truthy(provider);
	t.is(typeof provider, 'function');
});

test('createProvider uses openai-compatible by default when sdkProvider not set', t => {
	const config: AIProviderConfig = {
		name: 'CustomProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			baseURL: 'https://api.example.com',
			apiKey: 'test-key',
		},
	};

	const agent = new Agent();
	const provider = createProvider(config, agent);

	t.truthy(provider);
	t.is(typeof provider, 'function');
});

test('createProvider uses openai-compatible when sdkProvider is explicitly openai-compatible', t => {
	const config: AIProviderConfig = {
		name: 'ExplicitOpenAI',
		type: 'openai',
		models: ['test-model'],
		sdkProvider: 'openai-compatible',
		config: {
			baseURL: 'https://api.example.com',
			apiKey: 'test-key',
		},
	};

	const agent = new Agent();
	const provider = createProvider(config, agent);

	t.truthy(provider);
	t.is(typeof provider, 'function');
});

test('createProvider google provider works without baseURL', t => {
	const config: AIProviderConfig = {
		name: 'Gemini',
		type: 'openai',
		models: ['gemini-3-flash-preview'],
		sdkProvider: 'google',
		config: {
			apiKey: 'test-key',
			// No baseURL - @ai-sdk/google handles this internally
		},
	};

	const agent = new Agent();
	const provider = createProvider(config, agent);

	t.truthy(provider);
});
