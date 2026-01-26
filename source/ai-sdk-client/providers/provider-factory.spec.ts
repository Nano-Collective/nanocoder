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
