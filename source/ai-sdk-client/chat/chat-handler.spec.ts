import test from 'ava';
import {createOpenAI} from '@ai-sdk/openai';
import {streamText} from 'ai';
import type {
	AIProviderConfig,
	AISDKCoreTool,
	Message,
	StreamCallbacks,
} from '@/types/index';
import type {LanguageModel} from 'ai';
import {handleChat} from './chat-handler.js';
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
		onReasoningToken: () => {},
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
	t.truthy(params.callbacks.onReasoningToken);
	t.truthy(params.callbacks.onToolCall);
	t.truthy(params.callbacks.onFinish);
});

test('handleChat returns streamed text when SDK final text is unavailable', async t => {
	const streamedTokens: string[] = [];
	const providerConfig: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			baseURL: 'https://api.test.com',
		},
	};

	const result = await handleChat({
		model: {
			specificationVersion: 'v3',
			provider: 'test-provider',
			modelId: 'test-model',
			doStream: async () => ({
				stream: new ReadableStream({
					start(controller) {
						const usage = {
							inputTokens: 1,
							outputTokens: 1,
							totalTokens: 2,
						};
						controller.enqueue({type: 'text-start', id: '0'});
						controller.enqueue({type: 'text-delta', id: '0', delta: 'ok'});
						controller.enqueue({type: 'text-end', id: '0'});
						controller.enqueue({
							type: 'finish',
							finishReason: 'stop',
							usage,
						});
						controller.close();
					},
				}),
			}),
		} as LanguageModel,
		currentModel: 'test-model',
		providerConfig,
		messages: [{role: 'user', content: 'test'}],
		tools: {},
		callbacks: {
			onToken: token => streamedTokens.push(token),
		},
		maxRetries: 0,
	});

	t.deepEqual(streamedTokens, ['ok']);
	t.is(result.choices[0]?.message.content, 'ok');
});

test('OpenAI Responses parser tolerates reasoning item completion without tracked summaries', async t => {
	const provider = createOpenAI({
		apiKey: 'test-key',
		fetch: async () =>
			new Response(
				[
					toSse({
						type: 'response.created',
						response: {
							id: 'resp_1',
							created_at: 1,
							model: 'gpt-5.5',
						},
					}),
					toSse({
						type: 'response.output_item.done',
						output_index: 0,
						item: {
							id: 'rs_1',
							type: 'reasoning',
							encrypted_content: null,
						},
					}),
					toSse({
						type: 'response.completed',
						response: {
							id: 'resp_1',
							usage: {
								input_tokens: 1,
								output_tokens: 0,
								total_tokens: 1,
							},
						},
					}),
					'data: [DONE]\n\n',
				].join(''),
				{
					status: 200,
					headers: {'content-type': 'text/event-stream'},
				},
			),
	});

	const result = streamText({
		model: provider.responses('gpt-5.5'),
		prompt: 'test',
	});

	await t.notThrowsAsync(async () => {
		for await (const _chunk of result.fullStream) {
			// Drain the stream to exercise the Responses parser.
		}
	});
});

test('OpenAI Responses parser tolerates summary part events without tracked reasoning state', async t => {
	const provider = createOpenAI({
		apiKey: 'test-key',
		fetch: async () =>
			new Response(
				[
					toSse({
						type: 'response.created',
						response: {
							id: 'resp_1',
							created_at: 1,
							model: 'gpt-5.5',
						},
					}),
					toSse({
						type: 'response.reasoning_summary_part.added',
						item_id: 'rs_1',
						output_index: 0,
						summary_index: 1,
					}),
					toSse({
						type: 'response.reasoning_summary_part.done',
						item_id: 'rs_1',
						output_index: 0,
						summary_index: 1,
						part: {type: 'summary_text', text: ''},
					}),
					toSse({
						type: 'response.completed',
						response: {
							id: 'resp_1',
							usage: {
								input_tokens: 1,
								output_tokens: 0,
								total_tokens: 1,
							},
						},
					}),
					'data: [DONE]\n\n',
				].join(''),
				{
					status: 200,
					headers: {'content-type': 'text/event-stream'},
				},
			),
	});

	const result = streamText({
		model: provider.responses('gpt-5.5'),
		prompt: 'test',
	});

	await t.notThrowsAsync(async () => {
		for await (const _chunk of result.fullStream) {
			// Drain the stream to exercise the Responses parser.
		}
	});
});

function toSse(value: unknown): string {
	return `data: ${JSON.stringify(value)}\n\n`;
}
