import test from 'ava';
import {createOpenAI} from '@ai-sdk/openai';
import {jsonSchema, streamText, tool} from 'ai';
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

test('privacy: scrubs outgoing prompts and rehydrates the response at the history boundary', async t => {
	const providerConfig: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			baseURL: 'https://api.test.com',
		},
	};

	// Capture what actually reaches the provider (post-scrub), and echo back
	// whatever placeholder the model received — making this a true round-trip.
	let sentToProvider = '';
	const model = {
		specificationVersion: 'v3',
		provider: 'test-provider',
		modelId: 'test-model',
		doStream: async (options: {prompt: unknown}) => {
			sentToProvider = JSON.stringify(options.prompt);
			const placeholder = (sentToProvider.match(/«[^»]+»/) ?? ['«Email_1»'])[0];
			return {
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({type: 'text-start', id: '0'});
						controller.enqueue({
							type: 'text-delta',
							id: '0',
							delta: `Saved ${placeholder}`,
						});
						controller.enqueue({type: 'text-end', id: '0'});
						controller.enqueue({
							type: 'finish',
							finishReason: 'stop',
							usage: {inputTokens: 1, outputTokens: 1, totalTokens: 2},
						});
						controller.close();
					},
				}),
			};
		},
	} as unknown as LanguageModel;

	const privacySessionMapRef = {current: {} as Record<string, string>};

	const result = await handleChat({
		model,
		currentModel: 'test-model',
		providerConfig,
		messages: [{role: 'user', content: 'My email is real@example.com'}],
		tools: {},
		callbacks: {},
		maxRetries: 0,
		privacyEnabled: true,
		privacySessionMapRef,
	});

	// Outgoing request is scrubbed: the real email never reaches the provider.
	t.false(sentToProvider.includes('real@example.com'));
	t.regex(sentToProvider, /«Email_1»/);

	// The stateless scrub populated the in-memory session map in place.
	t.is(privacySessionMapRef.current['«Email_1»'], 'real@example.com');

	// The assistant reply is rehydrated BEFORE being returned, so committed
	// history holds the real value — never the placeholder.
	const content = result.choices[0]?.message.content ?? '';
	t.is(content, 'Saved real@example.com');
	t.false(content.includes('«'));
});

// Tool results are the largest and least-reviewed body of text leaving the
// machine, so they go through the same detectors as everything else.
async function scrubbedPayload(
	messages: Message[],
): Promise<{payload: string; sessionMap: Record<string, string>}> {
	const captured: {prompt?: unknown} = {};
	const sessionMap: Record<string, string> = {};
	await handleChat({
		model: capturingModel(captured),
		currentModel: 'test-model',
		providerConfig: {
			name: 'TestProvider',
			type: 'openai',
			models: ['test-model'],
			config: {baseURL: 'https://api.test.com'},
		},
		messages,
		tools: {},
		callbacks: {},
		maxRetries: 0,
		privacyEnabled: true,
		privacySessionMapRef: {current: sessionMap},
	});
	return {payload: JSON.stringify(captured.prompt), sessionMap};
}

test('privacy: scrubs tool result content', async t => {
	const {payload, sessionMap} = await scrubbedPayload([
		{role: 'user', content: 'who owns this?'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{id: 'call_1', function: {name: 'read_file', arguments: {path: '.env'}}},
			],
		},
		{
			role: 'tool',
			tool_call_id: 'call_1',
			name: 'read_file',
			content: 'OWNER=ops@example.com',
		},
	]);

	t.false(payload.includes('ops@example.com'));
	t.regex(payload, /«Email_\d+»/);
	t.true(Object.values(sessionMap).includes('ops@example.com'));
	// Paths stay in the clear — the agent has to be able to act on them.
	t.true(payload.includes('.env'));
});

test('privacy: scrubs the string leaves of structured tool output', async t => {
	const structuredContent = {
		matches: [{line: 'contact ops@example.com', count: 3}],
		truncated: false,
	};
	const {payload} = await scrubbedPayload([
		{role: 'user', content: 'search'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{id: 'call_1', function: {name: 'grep', arguments: {pattern: 'contact'}}},
			],
		},
		{
			role: 'tool',
			tool_call_id: 'call_1',
			name: 'grep',
			content: 'contact ops@example.com',
			structuredContent,
		},
	]);

	t.false(payload.includes('ops@example.com'));
	// Walking leaves rather than the serialised JSON leaves the shape intact.
	t.regex(payload, /"count":3/);
	t.regex(payload, /"truncated":false/);
	// The caller's message is untouched, so committed history keeps the real value.
	t.is(structuredContent.matches[0]?.line, 'contact ops@example.com');
});

test('privacy: scrubs assistant tool-call arguments replayed from history', async t => {
	const {payload} = await scrubbedPayload([
		{role: 'user', content: 'save it'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_1',
					function: {
						name: 'write_file',
						arguments: {path: 'notes.md', content: 'ping ops@example.com'},
					},
				},
			],
		},
		{
			role: 'tool',
			tool_call_id: 'call_1',
			name: 'write_file',
			content: 'written',
		},
	]);

	t.false(payload.includes('ops@example.com'));
	t.regex(payload, /«Email_\d+»/);
	t.true(payload.includes('notes.md'));
});

test('privacy: truncates a tool result before scrubbing it', async t => {
	// truncateToolResult keeps a head and a tail around an elision marker.
	// Scrubbing the truncated text means the cut can never land mid-placeholder
	// — and the elided middle is never fed to the detectors at all.
	const filler = 'x'.repeat(30_000);
	const {payload, sessionMap} = await scrubbedPayload([
		{role: 'user', content: 'cat the log'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{id: 'call_1', function: {name: 'bash', arguments: {command: 'cat log'}}},
			],
		},
		{
			role: 'tool',
			tool_call_id: 'call_1',
			name: 'bash',
			content: `head head@example.com ${filler} middle middle@example.com ${filler} tail tail@example.com`,
		},
	]);

	const captured = Object.values(sessionMap);
	t.true(captured.includes('head@example.com'));
	t.true(captured.includes('tail@example.com'));
	t.false(captured.includes('middle@example.com'));
	// Every placeholder that reaches the provider is whole: no opener in the
	// payload is left without the rest of its placeholder behind it.
	t.is(
		(payload.match(/«/g) ?? []).length,
		(payload.match(/«[A-Za-z]+_\d+»/g) ?? []).length,
	);
});

test('privacy: rehydrates tool-call arguments before the harness executes them', async t => {
	const model = {
		specificationVersion: 'v3',
		provider: 'test-provider',
		modelId: 'test-model',
		doStream: async (options: {prompt: unknown}) => {
			const sent = JSON.stringify(options.prompt);
			const placeholder = (sent.match(/«[^»]+»/) ?? ['«Email_1»'])[0];
			return {
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({
							type: 'tool-call',
							toolCallId: 'call_1',
							toolName: 'write_file',
							input: JSON.stringify({
								path: 'notes.md',
								content: `ping ${placeholder}`,
							}),
						});
						controller.enqueue({
							type: 'finish',
							finishReason: 'tool-calls',
							usage: {inputTokens: 1, outputTokens: 1, totalTokens: 2},
						});
						controller.close();
					},
				}),
			};
		},
	} as unknown as LanguageModel;

	const result = await handleChat({
		model,
		currentModel: 'test-model',
		providerConfig: {
			name: 'TestProvider',
			type: 'openai',
			models: ['test-model'],
			config: {baseURL: 'https://api.test.com'},
		},
		messages: [{role: 'user', content: 'ping ops@example.com'}],
		tools: {
			write_file: tool({
				description: 'write a file',
				inputSchema: jsonSchema({
					type: 'object',
					properties: {path: {type: 'string'}, content: {type: 'string'}},
				}),
			}),
		},
		callbacks: {},
		maxRetries: 0,
		privacyEnabled: true,
		privacySessionMapRef: {current: {}},
	});

	// The tool the harness is about to run receives the real value, not the
	// placeholder the model was shown.
	t.deepEqual(result.choices[0]?.message.tool_calls?.[0]?.function.arguments, {
		path: 'notes.md',
		content: 'ping ops@example.com',
	});
});

function streamingModel(parts: Record<string, unknown>[]): LanguageModel {
	return {
		specificationVersion: 'v3',
		provider: 'test-provider',
		modelId: 'test-model',
		doStream: async () => ({
			stream: new ReadableStream({
				start(controller) {
					for (const part of parts) {
						controller.enqueue(part);
					}
					controller.enqueue({
						type: 'finish',
						finishReason: 'stop',
						usage: {inputTokens: 1, outputTokens: 1, totalTokens: 2},
					});
					controller.close();
				},
			}),
		}),
	} as unknown as LanguageModel;
}

async function streamRouting(parts: Record<string, unknown>[]): Promise<{
	text: string[];
	reasoning: string[];
	content: string;
	finalReasoning: string | undefined;
}> {
	const text: string[] = [];
	const reasoning: string[] = [];
	const result = await handleChat({
		model: streamingModel(parts),
		currentModel: 'test-model',
		providerConfig: {
			name: 'TestProvider',
			type: 'openai',
			models: ['test-model'],
			config: {baseURL: 'https://api.test.com'},
		},
		messages: [{role: 'user', content: 'test'}],
		tools: {},
		callbacks: {
			onToken: token => text.push(token),
			onReasoningToken: token => reasoning.push(token),
		},
		maxRetries: 0,
	});
	return {
		text,
		reasoning,
		content: result.choices[0]?.message.content ?? '',
		finalReasoning: result.choices[0]?.message.reasoning,
	};
}

test('streams reasoning and text to their own callbacks', async t => {
	const routed = await streamRouting([
		{type: 'reasoning-start', id: 'r0'},
		{type: 'reasoning-delta', id: 'r0', delta: 'Checking the file'},
		{type: 'reasoning-end', id: 'r0'},
		{type: 'text-start', id: '0'},
		{type: 'text-delta', id: '0', delta: 'Hello'},
		{type: 'text-end', id: '0'},
	]);

	t.deepEqual(routed.reasoning, ['Checking the file']);
	t.deepEqual(routed.text, ['Hello']);
	t.is(routed.content, 'Hello');
	t.is(routed.finalReasoning, 'Checking the file');
});

test('buffered reasoning reaches onReasoningToken when text starts without reasoning-end', async t => {
	const routed = await streamRouting([
		{type: 'reasoning-start', id: 'r0'},
		{type: 'reasoning-delta', id: 'r0', delta: 'Thinking about it'},
		{type: 'text-start', id: '0'},
		{type: 'text-delta', id: '0', delta: 'Hello'},
		{type: 'text-end', id: '0'},
	]);

	t.deepEqual(routed.reasoning, ['Thinking about it']);
	t.deepEqual(routed.text, ['Hello']);
	t.is(routed.content, 'Hello');
});

test('buffered text reaches onToken when reasoning restarts without text-end', async t => {
	const routed = await streamRouting([
		{type: 'text-start', id: '0'},
		{type: 'text-delta', id: '0', delta: 'Let me check'},
		{type: 'reasoning-start', id: 'r0'},
		{type: 'reasoning-delta', id: 'r0', delta: 'internal thought'},
		{type: 'reasoning-end', id: 'r0'},
		{type: 'text-delta', id: '0', delta: ' done'},
		{type: 'text-end', id: '0'},
	]);

	t.deepEqual(routed.text, ['Let me check', ' done']);
	t.deepEqual(routed.reasoning, ['internal thought']);
	t.is(routed.content, 'Let me check done');
});

test('consecutive reasoning parts stay on the reasoning callback', async t => {
	const routed = await streamRouting([
		{type: 'reasoning-start', id: 'r0:0'},
		{type: 'reasoning-delta', id: 'r0:0', delta: 'Part one'},
		{type: 'reasoning-start', id: 'r0:1'},
		{type: 'reasoning-delta', id: 'r0:1', delta: 'Part two'},
		{type: 'text-start', id: '0'},
		{type: 'text-delta', id: '0', delta: 'Answer'},
		{type: 'text-end', id: '0'},
	]);

	t.deepEqual(routed.reasoning, ['Part one', 'Part two']);
	t.deepEqual(routed.text, ['Answer']);
});

test('reasoning deltas route on the reasoning callback without a reasoning-start', async t => {
	const routed = await streamRouting([
		{type: 'reasoning-delta', id: 'r0', delta: 'Unannounced thought'},
		{type: 'text-start', id: '0'},
		{type: 'text-delta', id: '0', delta: 'Answer'},
		{type: 'text-end', id: '0'},
	]);

	t.deepEqual(routed.reasoning, ['Unannounced thought']);
	t.deepEqual(routed.text, ['Answer']);
	t.is(routed.content, 'Answer');
});

test('reasoning deltas after reasoning-end stay on the reasoning callback', async t => {
	const routed = await streamRouting([
		{type: 'reasoning-start', id: 'r0'},
		{type: 'reasoning-delta', id: 'r0', delta: 'First half'},
		{type: 'reasoning-end', id: 'r0'},
		{type: 'reasoning-delta', id: 'r0', delta: 'Second half'},
		{type: 'text-start', id: '0'},
		{type: 'text-delta', id: '0', delta: 'Answer'},
		{type: 'text-end', id: '0'},
	]);

	t.deepEqual(routed.reasoning, ['First half', 'Second half']);
	t.deepEqual(routed.text, ['Answer']);
	t.is(routed.content, 'Answer');
});

test('alternating deltas with no start markers keep their own callbacks', async t => {
	const routed = await streamRouting([
		{type: 'reasoning-delta', id: 'r0', delta: 'Thinking'},
		{type: 'text-delta', id: '0', delta: 'Answer'},
		{type: 'reasoning-delta', id: 'r0', delta: 'More thinking'},
		{type: 'text-delta', id: '0', delta: ' continues'},
	]);

	t.deepEqual(routed.reasoning, ['Thinking', 'More thinking']);
	t.deepEqual(routed.text, ['Answer', ' continues']);
});

function capturingModel(captured: {prompt?: unknown}): LanguageModel {
	return {
		specificationVersion: 'v3',
		provider: 'anthropic',
		modelId: 'claude-sonnet-4-5',
		doStream: async (options: {prompt: unknown}) => {
			captured.prompt = options.prompt;
			return {
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({type: 'text-start', id: '0'});
						controller.enqueue({type: 'text-delta', id: '0', delta: 'ok'});
						controller.enqueue({type: 'text-end', id: '0'});
						controller.enqueue({
							type: 'finish',
							finishReason: 'stop',
							usage: {inputTokens: 5000, outputTokens: 10, totalTokens: 5010},
						});
						controller.close();
					},
				}),
			};
		},
	} as unknown as LanguageModel;
}

const anthropicConfig: AIProviderConfig = {
	name: 'Anthropic',
	type: 'anthropic',
	sdkProvider: 'anthropic',
	models: ['claude-sonnet-4-5'],
	config: {apiKey: 'test-key'},
};

const LONG_SYSTEM = 'SYSTEM '.repeat(1000);

test('handleChat sends the system prompt as a cache-marked message on anthropic', async t => {
	const captured: {prompt?: unknown} = {};
	await handleChat({
		model: capturingModel(captured),
		currentModel: 'claude-sonnet-4-5',
		providerConfig: anthropicConfig,
		messages: [
			{role: 'system', content: LONG_SYSTEM},
			{role: 'user', content: 'hello'},
		],
		tools: {},
		callbacks: {},
		maxRetries: 0,
	});

	const prompt = captured.prompt as Array<{
		role: string;
		providerOptions?: Record<string, unknown>;
	}>;
	t.is(prompt[0]?.role, 'system');
	t.deepEqual(prompt[0]?.providerOptions, {
		anthropic: {cacheControl: {type: 'ephemeral'}},
	});
	t.deepEqual(prompt[prompt.length - 1]?.providerOptions, {
		anthropic: {cacheControl: {type: 'ephemeral'}},
	});
});

test('handleChat does not emit the AI SDK system-in-messages warning', async t => {
	const warnings: string[] = [];
	const originalWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args.join(' '));
	};
	try {
		await handleChat({
			model: capturingModel({}),
			currentModel: 'claude-sonnet-4-5',
			providerConfig: anthropicConfig,
			messages: [
				{role: 'system', content: LONG_SYSTEM},
				{role: 'user', content: 'hello'},
			],
			tools: {},
			callbacks: {},
			maxRetries: 0,
		});
	} finally {
		console.warn = originalWarn;
	}
	t.false(warnings.some(w => w.includes('System messages in the prompt')));
});

test('handleChat keeps the system string for non-anthropic providers', async t => {
	const captured: {prompt?: unknown} = {};
	await handleChat({
		model: capturingModel(captured),
		currentModel: 'test-model',
		providerConfig: {
			name: 'TestProvider',
			type: 'openai',
			models: ['test-model'],
			config: {baseURL: 'https://api.test.com'},
		},
		messages: [
			{role: 'system', content: LONG_SYSTEM},
			{role: 'user', content: 'hello'},
		],
		tools: {},
		callbacks: {},
		maxRetries: 0,
	});

	const prompt = captured.prompt as Array<{
		role: string;
		providerOptions?: Record<string, unknown>;
	}>;
	t.is(prompt[0]?.role, 'system');
	t.is(prompt[0]?.providerOptions, undefined);
	t.is(prompt[prompt.length - 1]?.providerOptions, undefined);
});
