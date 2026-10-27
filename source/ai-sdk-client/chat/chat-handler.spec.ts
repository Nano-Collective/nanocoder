import test from 'ava';
import {createAnthropic} from '@ai-sdk/anthropic';
import {createOpenAI} from '@ai-sdk/openai';
import {
	InvalidToolInputError,
	jsonSchema,
	NoSuchToolError,
	streamText,
	tool,
} from 'ai';
import type {
	AIProviderConfig,
	AISDKCoreTool,
	Message,
	StreamCallbacks,
} from '@/types/index';
import type {LanguageModel} from 'ai';
import {handleChat, stopOnInvalidToolCall} from './chat-handler.js';
import type {ChatHandlerParams} from './chat-handler.js';
import {rehydrateResponse} from './privacy.js';

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

test('privacy: keeps placeholders whole when scrubbing expands a result past the cap', async t => {
	// Short, dense, distinct emails: each «Email_N» placeholder (9+ chars) is
	// longer than the "aN@b.co " it replaces (7-8 chars for most N in this
	// range), so scrubbing grows the text past MAX_TOOL_RESULT_CHARS even
	// though the raw content started under it — the cap is only breached
	// AFTER scrubbing, exercising the boundary the converter's own
	// re-truncation (message-converter.ts) has to respect.
	let content = '';
	let i = 0;
	while (content.length < 19_500) {
		content += `a${i}@b.co `;
		i++;
	}

	const {payload} = await scrubbedPayload([
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
			content,
		},
	]);

	// Confirms the scrub-then-retruncate path actually fired, rather than the
	// assertion below passing vacuously because nothing was cut.
	t.regex(payload, /Output truncated/);
	// Every placeholder that reaches the provider is whole: the converter's
	// re-truncation of the scrub-expanded text never lands mid-token.
	t.is(
		(payload.match(/«/g) ?? []).length,
		(payload.match(/«[A-Za-z]+_\d+»/g) ?? []).length,
	);
});

test('privacy: pre-truncates an over-cap structured tool result before scrubbing it', async t => {
	// lsp_get_diagnostics on a large repo is a realistic producer of a
	// structuredContent payload that's already over MAX_TOOL_RESULT_CHARS
	// before scrubbing even runs — leaf-scrubbing the whole thing would be
	// wasted work, since the converter would truncate-and-downgrade it to
	// text regardless.
	const diagnostics = Array.from({length: 2000}, (_, i) => ({
		file: `file${i}.ts`,
		message: `contact user${i}@example.com`,
	}));

	const {payload} = await scrubbedPayload([
		{role: 'user', content: 'check the repo'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_1',
					function: {name: 'lsp_get_diagnostics', arguments: {path: '.'}},
				},
			],
		},
		{
			role: 'tool',
			tool_call_id: 'call_1',
			name: 'lsp_get_diagnostics',
			content: `${diagnostics.length} diagnostics found`,
			structuredContent: {diagnostics},
		},
	]);

	// The full ~130k-char diagnostics list never reaches the payload —
	// it was downgraded to bounded text before scrubbing ran.
	t.true(payload.length < 100_000);
	t.regex(payload, /Output truncated/);
	// The kept portion is still scrubbed, and every placeholder in it whole.
	t.regex(payload, /«Email_\d+»/);
	t.is(
		(payload.match(/«/g) ?? []).length,
		(payload.match(/«[A-Za-z]+_\d+»/g) ?? []).length,
	);
});

test('privacy: isolates one tool call rehydration failure from the rest', async t => {
	// mapStringLeaves walks arguments with Object.entries, which invokes
	// getters — a poisoned argument makes that throw, standing in for any
	// unexpected rehydration failure the old try/catch used to contain.
	const poisoned: Record<string, unknown> = {};
	Object.defineProperty(poisoned, 'secret', {
		enumerable: true,
		get(): never {
			throw new Error('boom');
		},
	});

	const toolCalls = [
		{
			id: 'call_1',
			function: {name: 'broken_tool', arguments: {nested: poisoned}},
		},
		{
			id: 'call_2',
			function: {
				name: 'write_file',
				arguments: {content: 'ping «Email_1»'},
			},
		},
	];

	const response = await rehydrateResponse(
		{content: '', toolCalls},
		{'«Email_1»': 'real@example.com'},
	);

	// The tool call whose arguments can't be walked falls back to its
	// original, unmodified value instead of throwing out of
	// rehydrateResponse — where chat-handler.ts's outer catch would
	// misread it as an API error or trigger the skipTools retry.
	t.is(response.toolCalls[0], toolCalls[0]);
	// A second tool call in the same response still rehydrates normally.
	t.deepEqual(response.toolCalls[1]?.function.arguments, {
		content: 'ping real@example.com',
	});
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

// --- Output-token ceiling ---
//
// @ai-sdk/anthropic derives max_tokens from the model id and falls back to
// 4096 for anything it does not recognise as a Claude model. An
// Anthropic-compatible endpoint serving some other model therefore truncates
// every reply at 4096 unless the ceiling is set explicitly — and nanocoder was
// setting it under the v4 name `maxTokens`, which v5+ ignores. Object spreads
// skip excess-property checking, so that was dropped silently rather than
// failing to compile.
//
// These pin the SDK contract the fix depends on: assert what reaches the wire,
// since typechecking demonstrably cannot catch this class of mistake.

async function captureAnthropicRequestBody(
	settings: {maxOutputTokens?: number},
	modelId: string,
): Promise<Record<string, unknown>> {
	let captured: Record<string, unknown> = {};
	const provider = createAnthropic({
		apiKey: 'test-key',
		fetch: async (_url, init) => {
			captured = JSON.parse(String(init?.body));
			return new Response(
				[
					'event: message_start\ndata: {"type":"message_start","message":{"id":"m","type":"message","role":"assistant","model":"m","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
					'event: message_stop\ndata: {"type":"message_stop"}\n\n',
				].join(''),
				{status: 200, headers: {'content-type': 'text/event-stream'}},
			);
		},
	});

	const result = streamText({
		model: provider(modelId),
		prompt: 'test',
		...settings,
	});
	for await (const _chunk of result.fullStream) {
		// Drain so the request is actually issued.
	}
	return captured;
}

test('an unrecognised model id falls back to a 4096 output ceiling', async t => {
	const body = await captureAnthropicRequestBody({}, 'minimax-m3');
	t.is(
		body.max_tokens,
		4096,
		'this default is the reason provider entries need an explicit ceiling',
	);
});

test('maxOutputTokens raises the ceiling that reaches the provider', async t => {
	const body = await captureAnthropicRequestBody(
		{maxOutputTokens: 32_000},
		'minimax-m3',
	);
	t.is(body.max_tokens, 32_000);
});

test('the v4 spelling maxTokens does not reach the provider', async t => {
	// Regression guard: if this ever starts passing, the SDK has renamed the
	// setting back and the mapping in chat-handler needs revisiting.
	const body = await captureAnthropicRequestBody(
		{maxTokens: 32_000} as {maxOutputTokens?: number},
		'minimax-m3',
	);
	t.is(
		body.max_tokens,
		4096,
		'maxTokens is silently ignored — the bug this fix exists for',
	);
});

// A stuck model sending an invalid call must reach the conversation loop's
// retry limits, not loop inside one SDK call.
test('stopOnInvalidToolCall stops on a call to a tool that does not exist', t => {
	const unknown = {
		type: 'tool-call',
		toolCallId: 'c1',
		toolName: 'no_such_tool',
		input: {},
		dynamic: true,
		invalid: true,
		error: new NoSuchToolError({toolName: 'no_such_tool'}),
	};
	const valid = {
		type: 'tool-call',
		toolCallId: 'c2',
		toolName: 'read_file',
		input: {path: 'a'},
	};
	const steps = (toolCalls: unknown[]) =>
		({steps: [{toolCalls}]}) as unknown as Parameters<
			typeof stopOnInvalidToolCall
		>[0];

	t.true(stopOnInvalidToolCall(steps([unknown])) as boolean);
	t.false(stopOnInvalidToolCall(steps([valid])) as boolean);
	t.true(stopOnInvalidToolCall(steps([valid, unknown])) as boolean);
	t.false(stopOnInvalidToolCall({steps: []} as never) as boolean);
});

test('stopOnInvalidToolCall stops on an unparsable call to a real tool', t => {
	// The shape the SDK gives a call to a real tool whose arguments do not
	// parse: the raw text as `input` and an InvalidToolInputError.
	const unparsable = {
		type: 'tool-call',
		toolCallId: 'c1',
		toolName: 'read_file',
		input: '{"path": "hello.txt"',
		dynamic: true,
		invalid: true,
		error: new InvalidToolInputError({
			toolName: 'read_file',
			toolInput: '{"path": "hello.txt"',
			cause: new SyntaxError('bad json'),
		}),
	};
	const steps = {steps: [{toolCalls: [unparsable]}]} as unknown as Parameters<
		typeof stopOnInvalidToolCall
	>[0];

	t.true(stopOnInvalidToolCall(steps) as boolean);
});

test('openai-compatible: a tool screenshot reaches the request body as an image_url part', async t => {
	const {createOpenAICompatible} = await import('@ai-sdk/openai-compatible');
	let body: {messages: Array<{role: string; content: unknown}>} | undefined;
	const model = createOpenAICompatible({
		name: 'Ollama',
		baseURL: 'http://localhost:11434/v1',
		fetch: async (_input, init) => {
			body = JSON.parse(String(init?.body));
			throw new Error('request captured');
		},
	})('llava');

	await handleChat({
		model,
		currentModel: 'llava',
		providerConfig: {
			name: 'Ollama',
			type: 'openai',
			models: ['llava'],
			config: {baseURL: 'http://localhost:11434/v1'},
		},
		messages: [
			{role: 'user', content: 'check the page'},
			{
				role: 'assistant',
				content: '',
				tool_calls: [
					{id: 'call_shot', function: {name: 'browser', arguments: {}}},
				],
			},
			{
				role: 'tool',
				content: 'Screenshot of http://localhost:3000/',
				tool_call_id: 'call_shot',
				name: 'browser',
				images: [{data: 'SCREENSHOT_B64', mediaType: 'image/jpeg'}],
			},
		],
		tools: {},
		callbacks: {},
		maxRetries: 0,
	}).catch(() => undefined);

	const [, , toolMessage, imageMessage] = body?.messages ?? [];
	t.deepEqual(toolMessage, {
		role: 'tool',
		tool_call_id: 'call_shot',
		content: 'Screenshot of http://localhost:3000/',
	});
	t.deepEqual(imageMessage, {
		role: 'user',
		content: [
			{type: 'text', text: 'Images from the tool results above.'},
			{
				type: 'image_url',
				image_url: {url: 'data:image/jpeg;base64,SCREENSHOT_B64'},
			},
		],
	});
});

const screenshotHistory = (): Message[] => [
	{role: 'user', content: 'check the page'},
	{
		role: 'assistant',
		content: '',
		tool_calls: [{id: 'call_shot', function: {name: 'browser', arguments: {}}}],
	},
	{
		role: 'tool',
		content: 'Screenshot of http://localhost:3000/',
		tool_call_id: 'call_shot',
		name: 'browser',
		images: [{data: 'SCREENSHOT_B64', mediaType: 'image/jpeg'}],
	},
];

async function chatWithLocalServer(
	modelId: string,
	respond: (body: string, call: number) => Response,
) {
	const {createOpenAICompatible} = await import('@ai-sdk/openai-compatible');
	const bodies: string[] = [];
	const model = createOpenAICompatible({
		name: 'llama.cpp',
		baseURL: 'http://localhost:8080/v1',
		fetch: async (_input, init) => {
			const body = String(init?.body);
			bodies.push(body);
			return respond(body, bodies.length);
		},
	})(modelId);
	const run = () =>
		handleChat({
			model,
			currentModel: modelId,
			providerConfig: {
				name: 'llama.cpp',
				type: 'openai',
				models: [modelId],
				config: {baseURL: 'http://localhost:8080/v1'},
			},
			messages: screenshotHistory(),
			tools: {},
			callbacks: {},
			maxRetries: 0,
		});
	return {bodies, run};
}

const imageRefusal = () =>
	new Response(
		JSON.stringify({
			error: {
				message:
					'image input is not supported - hint: if this is unexpected, you may need to provide the mmproj',
			},
		}),
		{status: 500, headers: {'content-type': 'application/json'}},
	);

const sseReply = (text: string) =>
	new Response(
		[
			`data: ${JSON.stringify({id: '1', choices: [{index: 0, delta: {role: 'assistant', content: text}}]})}`,
			`data: ${JSON.stringify({id: '1', choices: [{index: 0, delta: {}, finish_reason: 'stop'}]})}`,
			'data: [DONE]',
			'',
		].join('\n\n'),
		{status: 200, headers: {'content-type': 'text/event-stream'}},
	);

test.serial('a text-only local model that refuses a screenshot is retried without it and remembered', async t => {
	const {bodies, run} = await chatWithLocalServer(
		'local-text-only-refuses-images',
		body => (body.includes('SCREENSHOT_B64') ? imageRefusal() : sseReply('ok')),
	);

	const first = await run();
	t.is(first.choices[0]?.message.content, 'ok');
	t.is(bodies.length, 2);
	t.true(bodies[0]?.includes('SCREENSHOT_B64'));
	t.false(bodies[1]?.includes('SCREENSHOT_B64'));
	t.true(bodies[1]?.includes('Image not sent'));

	// The next turn omits the image up front instead of failing again.
	await run();
	t.is(bodies.length, 3);
	t.false(bodies[2]?.includes('SCREENSHOT_B64'));
});

test.serial('an unrelated server error is not retried without images', async t => {
	const {bodies, run} = await chatWithLocalServer(
		'local-model-unrelated-error',
		() =>
			new Response(JSON.stringify({error: {message: 'out of memory'}}), {
				status: 500,
				headers: {'content-type': 'application/json'},
			}),
	);
	await t.throwsAsync(run());
	t.is(bodies.length, 1);
});

// --- Invalid tool calls end the step ---
//
// A model that always answers with the same tool call, as a stuck model does.
// Every request is counted: before the fix, an unparsable call to a real tool
// made the SDK answer it with an automatic error and run another step, up to
// MAX_TOOL_STEPS requests inside one chat() call, none of them visible to the
// conversation loop's steps, usage or retry limits.

const sseToolCall = (
	name: string,
	args: string,
	finishReason: 'tool_calls' | 'length',
) =>
	new Response(
		[
			`data: ${JSON.stringify({id: '1', choices: [{index: 0, delta: {role: 'assistant', tool_calls: [{index: 0, id: 'call_1', type: 'function', function: {name, arguments: args}}]}}]})}`,
			`data: ${JSON.stringify({id: '1', choices: [{index: 0, delta: {}, finish_reason: finishReason}], usage: {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15}})}`,
			'data: [DONE]',
			'',
		].join('\n\n'),
		{status: 200, headers: {'content-type': 'text/event-stream'}},
	);

async function chatWithRepeatedToolCall(
	name: string,
	args: string,
	finishReason: 'tool_calls' | 'length' = 'tool_calls',
) {
	const {createOpenAICompatible} = await import('@ai-sdk/openai-compatible');
	let requests = 0;
	const model = createOpenAICompatible({
		name: 'scripted',
		baseURL: 'http://localhost:8080/v1',
		fetch: async () => {
			requests++;
			return sseToolCall(name, args, finishReason);
		},
	})('scripted-model');
	const response = await handleChat({
		model,
		currentModel: 'scripted-model',
		providerConfig: {
			name: 'scripted',
			type: 'openai',
			models: ['scripted-model'],
			config: {baseURL: 'http://localhost:8080/v1'},
		},
		messages: [{role: 'user', content: 'read hello.txt'}],
		tools: {
			read_file: tool({
				description: 'read a file',
				inputSchema: jsonSchema({
					type: 'object',
					properties: {path: {type: 'string'}},
				}),
			}),
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
	});
	return {requests, response};
}

test.serial('an unparsable call to a real tool comes back after one request', async t => {
	const {requests, response} = await chatWithRepeatedToolCall(
		'read_file',
		'{"path": "hello.txt"',
	);

	t.is(requests, 1);
	// The usage is that one request's, so nothing the provider served is
	// missing from it.
	t.is(response.usage?.totalTokens, 15);
	const [call] = response.choices[0]?.message.tool_calls ?? [];
	t.is(call?.function.name, 'read_file');
	// The raw text is not passed on as the arguments: it would be executed as
	// the arguments and replayed to the provider double-encoded.
	t.deepEqual(call?.function.arguments, {});
	t.regex(call?.argumentsError ?? '', /^not valid JSON: /);
});

test.serial('a call cut off at the output-token limit comes back after one request', async t => {
	const {requests, response} = await chatWithRepeatedToolCall(
		'write_file',
		'{"path": "notes.md", "content": "# Notes\\n\\nThe first line of a long fi',
		'length',
	);

	t.is(requests, 1);
	t.is(response.finishReason, 'length');
	const [call] = response.choices[0]?.message.tool_calls ?? [];
	t.deepEqual(call?.function.arguments, {});
	t.regex(call?.argumentsError ?? '', /^not valid JSON: /);
});

test.serial('a valid call still comes back after one request with its arguments', async t => {
	const {requests, response} = await chatWithRepeatedToolCall(
		'read_file',
		'{"path": "hello.txt"}',
	);

	t.is(requests, 1);
	const [call] = response.choices[0]?.message.tool_calls ?? [];
	t.deepEqual(call?.function.arguments, {path: 'hello.txt'});
	t.is(call?.argumentsError, undefined);
});
