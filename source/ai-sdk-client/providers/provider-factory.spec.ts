import test from 'ava';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

test('createProvider uses @ai-sdk/anthropic when sdkProvider is anthropic', t => {
	const config: AIProviderConfig = {
		name: 'Anthropic',
		type: 'openai',
		models: ['claude-sonnet-4-5-20250929'],
		sdkProvider: 'anthropic',
		config: {
			apiKey: 'test-key',
		},
	};

	const agent = new Agent();
	const provider = createProvider(config, agent);

	t.truthy(provider);
	t.is(typeof provider, 'function');
});

test('createProvider anthropic provider works without baseURL', t => {
	const config: AIProviderConfig = {
		name: 'Anthropic',
		type: 'openai',
		models: ['claude-sonnet-4-5-20250929'],
		sdkProvider: 'anthropic',
		config: {
			apiKey: 'test-key',
			// No baseURL - @ai-sdk/anthropic handles this internally
		},
	};

	const agent = new Agent();
	const provider = createProvider(config, agent);

	t.truthy(provider);
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

test.serial('createProvider throws when github-copilot has no stored credential', t => {
	const config: AIProviderConfig = {
		name: 'GitHub Copilot',
		type: 'openai',
		models: ['gpt-4o'],
		sdkProvider: 'github-copilot',
		config: {
			baseURL: 'https://api.githubcopilot.com',
			apiKey: '',
		},
	};

	const tmpDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'nanocoder-copilot-test-'),
	);
	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = tmpDir;
	try {
		const agent = new Agent();
		t.throws(
			() => createProvider(config, agent),
			{message: /No Copilot credentials/},
		);
	} finally {
		if (originalConfigDir !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
		fs.rmSync(tmpDir, {recursive: true, force: true});
	}
});
