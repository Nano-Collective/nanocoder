import test from 'ava';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {AIProviderConfig} from '@/types/index';
import {Agent} from 'undici';
import {createProvider} from './provider-factory.js';

test('createProvider creates provider with basic config', async t => {
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
	const provider = await createProvider(config, agent);

	t.truthy(provider);
	t.is(typeof provider.provider, 'function');
	t.is(typeof provider.kind, 'string');
});

test('createProvider adds OpenRouter headers for openrouter provider', async t => {
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
	const provider = await createProvider(config, agent);

	t.truthy(provider);
});

test('createProvider handles provider with no API key', async t => {
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
	const provider = await createProvider(config, agent);

	t.truthy(provider);
});

test('createProvider handles provider with no baseURL', async t => {
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
	const provider = await createProvider(config, agent);

	t.truthy(provider);
});

test('createProvider handles provider with no custom headers', async t => {
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
	const provider = await createProvider(config, agent);

	t.truthy(provider);
});

test('createProvider uses @ai-sdk/google when sdkProvider is google', async t => {
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
	const provider = await createProvider(config, agent);

	t.truthy(provider);
	t.is(typeof provider.provider, 'function');
	t.is(typeof provider.kind, 'string');
});

test('createProvider uses @ai-sdk/anthropic when sdkProvider is anthropic', async t => {
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
	const provider = await createProvider(config, agent);

	t.truthy(provider);
	t.is(typeof provider.provider, 'function');
	t.is(typeof provider.kind, 'string');
});

test('createProvider anthropic provider works without baseURL', async t => {
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
	const provider = await createProvider(config, agent);

	t.truthy(provider);
});

test('createProvider uses openai-compatible by default when sdkProvider not set', async t => {
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
	const provider = await createProvider(config, agent);

	t.truthy(provider);
	t.is(typeof provider.provider, 'function');
	t.is(typeof provider.kind, 'string');
});

test('createProvider uses openai-compatible when sdkProvider is explicitly openai-compatible', async t => {
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
	const provider = await createProvider(config, agent);

	t.truthy(provider);
	t.is(typeof provider.provider, 'function');
	t.is(typeof provider.kind, 'string');
});

test('createProvider google provider works without baseURL', async t => {
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
	const provider = await createProvider(config, agent);

	t.truthy(provider);
});

test('createProvider anthropic provider accepts caCertPath without throwing', async t => {
	// Regression: anthropic must wire a custom fetch through the undici Agent
	// so the caCertPath TLS bundle is honored. Without it, requests bypass the
	// dispatcher and the configured CA is silently ignored.
	const tmpDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'nanocoder-anthropic-ca-'),
	);
	const caPath = path.join(tmpDir, 'ca.pem');
	fs.writeFileSync(caPath, 'fake-bundle');

	const config: AIProviderConfig = {
		name: 'Anthropic',
		type: 'openai',
		models: ['claude-sonnet-4-5-20250929'],
		sdkProvider: 'anthropic',
		config: {
			apiKey: 'test-key',
			caCertPath: caPath,
		},
	};

	try {
		const agent = new Agent();
		const provider = await createProvider(config, agent);
		t.truthy(provider);
	} finally {
		fs.rmSync(tmpDir, {recursive: true, force: true});
	}
});

test('createProvider google provider accepts caCertPath without throwing', async t => {
	const tmpDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'nanocoder-google-ca-'),
	);
	const caPath = path.join(tmpDir, 'ca.pem');
	fs.writeFileSync(caPath, 'fake-bundle');

	const config: AIProviderConfig = {
		name: 'Gemini',
		type: 'openai',
		models: ['gemini-2.5-flash'],
		sdkProvider: 'google',
		config: {
			apiKey: 'test-key',
			caCertPath: caPath,
		},
	};

	try {
		const agent = new Agent();
		const provider = await createProvider(config, agent);
		t.truthy(provider);
	} finally {
		fs.rmSync(tmpDir, {recursive: true, force: true});
	}
});

test.serial('createProvider throws when chatgpt-codex has no stored credential', async t => {
	const config: AIProviderConfig = {
		name: 'ChatGPT / Codex',
		type: 'openai',
		models: ['gpt-5.4'],
		sdkProvider: 'chatgpt-codex',
		config: {
			baseURL: 'https://chatgpt.com/backend-api/codex',
			apiKey: '',
		},
	};

	const tmpDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'nanocoder-codex-test-'),
	);
	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = tmpDir;
	try {
		const agent = new Agent();
		await t.throwsAsync(
			() => createProvider(config, agent),
			{message: /No Codex credentials/},
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

test.serial('createProvider creates chatgpt-codex provider with stored credential', async t => {
	const config: AIProviderConfig = {
		name: 'ChatGPT / Codex',
		type: 'openai',
		models: ['gpt-5.4'],
		sdkProvider: 'chatgpt-codex',
		config: {
			baseURL: 'https://chatgpt.com/backend-api/codex',
			apiKey: '',
		},
	};

	const tmpDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'nanocoder-codex-test-'),
	);
	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = tmpDir;
	try {
		// Write a credential file
		fs.writeFileSync(
			path.join(tmpDir, 'codex-credentials.json'),
			JSON.stringify({
				'ChatGPT / Codex': {
					accessToken: 'test-token',
					refreshToken: 'test-refresh',
					expiresAt: Date.now() + 3600000,
					accountId: 'acc-1',
				},
			}),
			{encoding: 'utf-8', mode: 0o600},
		);

		const agent = new Agent();
		const provider = await createProvider(config, agent);
		t.truthy(provider);
	} finally {
		if (originalConfigDir !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
		fs.rmSync(tmpDir, {recursive: true, force: true});
	}
});

test.serial('createProvider throws when github-copilot has no stored credential', async t => {
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
		await t.throwsAsync(
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
