import test from 'ava';
import type {
	AIProviderConfig,
	AISDKCoreTool,
	Message,
	StreamCallbacks,
} from '@/types/index';
import type {LanguageModel} from 'ai';
import type {ChatHandlerParams} from './chat-handler.js';

// Note: This file contains basic structure tests
// Full integration tests would require mocking the AI SDK's streamText function
// which is complex and better tested through the full AISDKClient

test('ChatHandlerParams has correct structure', t => {
	const params: ChatHandlerParams = {
		model: {} as LanguageModel,
		currentModel: 'test-model',
		providerConfig: {
			name: 'TestProvider',
			type: 'openai',
			models: ['test-model'],
			config: {
				baseURL: 'https://api.test.com',
				apiKey: 'test-key',
			},
		},
		messages: [],
		tools: {},
		callbacks: {},
		maxRetries: 2,
	};

	t.is(params.currentModel, 'test-model');
	t.is(params.providerConfig.name, 'TestProvider');
	t.deepEqual(params.messages, []);
	t.deepEqual(params.tools, {});
});

test('ChatHandlerParams accepts optional signal', t => {
	const controller = new AbortController();
	const params: ChatHandlerParams = {
		model: {} as LanguageModel,
		currentModel: 'test-model',
		providerConfig: {
			name: 'TestProvider',
			type: 'openai',
			models: ['test-model'],
			config: {
				baseURL: 'https://api.test.com',
			},
		},
		messages: [],
		tools: {},
		callbacks: {},
		signal: controller.signal,
		maxRetries: 2,
	};

	t.is(params.signal, controller.signal);
});

test('ChatHandlerParams accepts messages and tools', t => {
	const messages: Message[] = [
		{role: 'user', content: 'Hello'},
	];
	const tools: Record<string, AISDKCoreTool> = {
		test_tool: {} as AISDKCoreTool,
	};

	const params: ChatHandlerParams = {
		model: {} as LanguageModel,
		currentModel: 'test-model',
		providerConfig: {
			name: 'TestProvider',
			type: 'openai',
			models: ['test-model'],
			config: {
				baseURL: 'https://api.test.com',
			},
		},
		messages,
		tools,
		callbacks: {},
		maxRetries: 2,
	};

	t.is(params.messages.length, 1);
	t.is(Object.keys(params.tools).length, 1);
});

test('ChatHandlerParams accepts callbacks', t => {
	const callbacks: StreamCallbacks = {
		onToken: () => {},
		onToolCall: () => {},
		onFinish: () => {},
	};

	const params: ChatHandlerParams = {
		model: {} as LanguageModel,
		currentModel: 'test-model',
		providerConfig: {
			name: 'TestProvider',
			type: 'openai',
			models: ['test-model'],
			config: {
				baseURL: 'https://api.test.com',
			},
		},
		messages: [],
		tools: {},
		callbacks,
		maxRetries: 2,
	};

	t.truthy(params.callbacks.onToken);
	t.truthy(params.callbacks.onToolCall);
	t.truthy(params.callbacks.onFinish);
});
