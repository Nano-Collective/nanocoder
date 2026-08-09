import test from 'ava';
import type {AIProviderConfig} from '@/types/index';
import {AISDKClient} from './ai-sdk-client.js';
import type {TaggedProvider} from './providers/provider-factory.js';

test('AISDKClient constructor initializes with config', t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model-1', 'test-model-2'],
		config: {
			baseURL: 'https://api.test.com',
			apiKey: 'test-key',
		},
	};

	const client = new AISDKClient(config);

	t.is(client.getCurrentModel(), 'test-model-1');
	t.is(client.getContextSize(), 0); // Not yet loaded
	t.is(client.getMaxRetries(), 2); // Default value
});

test('AISDKClient.create returns a Promise', async t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			baseURL: 'https://api.test.com',
			apiKey: 'test-key',
		},
	};

	const client = await AISDKClient.create(config);

	t.truthy(client);
	t.true(client instanceof AISDKClient);
});

test('AISDKClient setModel updates current model', t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['model-1', 'model-2'],
		config: {
			baseURL: 'https://api.test.com',
		},
	};

	const client = new AISDKClient(config);
	t.is(client.getCurrentModel(), 'model-1');

	client.setModel('model-2');
	t.is(client.getCurrentModel(), 'model-2');
});

test('AISDKClient getAvailableModels returns models array', async t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['model-1', 'model-2', 'model-3'],
		config: {
			baseURL: 'https://api.test.com',
		},
	};

	const client = new AISDKClient(config);
	const models = await client.getAvailableModels();

	t.deepEqual(models, ['model-1', 'model-2', 'model-3']);
});

test('AISDKClient clearContext resolves successfully', async t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			baseURL: 'https://api.test.com',
		},
	};

	const client = new AISDKClient(config);

	await t.notThrowsAsync(async () => {
		await client.clearContext();
	});
});

test('AISDKClient uses custom maxRetries from config', t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		maxRetries: 5,
		config: {
			baseURL: 'https://api.test.com',
		},
	};

	const client = new AISDKClient(config);
	t.is(client.getMaxRetries(), 5);
});

test('AISDKClient handles config without models', t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: [],
		config: {
			baseURL: 'https://api.test.com',
		},
	};

	const client = new AISDKClient(config);
	t.is(client.getCurrentModel(), '');
});

test('AISDKClient sends the normalized Atlas model to its provider', async t => {
	const config: AIProviderConfig = {
		name: 'Atlas Cloud',
		type: 'openai',
		models: ['gpt-5.6-sol'],
		config: {
			baseURL: 'https://api.atlascloud.ai/v1',
			apiKey: 'test-key',
		},
	};
	const client = new AISDKClient(config);
	let receivedModel: string | undefined;
	const provider = ((model: string): never => {
		receivedModel = model;
		throw new Error('model captured');
	}) as unknown as Extract<
		TaggedProvider,
		{kind: 'openai-compatible'}
	>['provider'];
	(client as unknown as {provider: TaggedProvider}).provider = {
		kind: 'openai-compatible',
		provider,
	};

	await t.throwsAsync(client.chat([], {}, {}), {message: 'model captured'});

	t.is(receivedModel, 'openai/gpt-5.6-sol');
});
