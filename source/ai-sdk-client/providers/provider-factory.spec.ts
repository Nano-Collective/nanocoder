import test from 'ava';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {AIProviderConfig} from '@/types/index';
import {Agent, MockAgent} from 'undici';
import {
	createProvider,
	createReasoningItemNormalizer,
	createUndiciFetch,
} from './provider-factory.js';

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

test('createProvider adds Requesty headers for requesty provider', async t => {
	const config: AIProviderConfig = {
		name: 'Requesty',
		type: 'openai',
		models: ['openai/gpt-4o-mini'],
		config: {
			baseURL: 'https://router.requesty.ai/v1',
			apiKey: 'test-key',
		},
	};

	const agent = new Agent();
	const provider = await createProvider(config, agent);

	t.truthy(provider);
	t.is(provider.kind, 'openai-compatible');
});

test('createProvider adds OrcaRouter headers for orcarouter provider', async t => {
	const config: AIProviderConfig = {
		name: 'OrcaRouter',
		type: 'openai',
		models: ['openai/gpt-5.5'],
		config: {
			baseURL: 'https://api.orcarouter.ai/v1',
			apiKey: 'test-key',
		},
	};

	const agent = new Agent();
	const provider = await createProvider(config, agent);

	t.truthy(provider);
	t.is(provider.kind, 'openai-compatible');
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

test('createUndiciFetch patches double spaces in SSE data: [DONE]', async t => {
	const mockAgent = new MockAgent();
	mockAgent.disableNetConnect();

	const mockPool = mockAgent.get('https://api.atlascloud.ai');
	mockPool.intercept({
		path: '/v1/chat/completions',
		method: 'POST',
	}).reply(200, 'data:  [DONE]', {
		headers: {'content-type': 'text/event-stream'},
	});

	const fetchFn = createUndiciFetch(mockAgent as unknown as Agent);
	const response = await fetchFn('https://api.atlascloud.ai/v1/chat/completions', {
		method: 'POST',
	});

	const text = await response.text();
	t.is(text, 'data: [DONE]');
});

test('createUndiciFetch patches double spaces when data: [DONE] is split across chunks', async t => {
	const http = await import('node:http');
	const server = http.createServer((req, res) => {
		res.writeHead(200, {'Content-Type': 'text/event-stream'});
		res.write('data:');
		setTimeout(() => {
			res.write('  ');
			setTimeout(() => {
				res.end('[DONE]');
			}, 10);
		}, 10);
	});

	await new Promise<void>((resolve) => server.listen(0, resolve));
	const port = (server.address() as any).port;

	const agent = new Agent();
	const fetchFn = createUndiciFetch(agent);
	const response = await fetchFn(`http://localhost:${port}/v1/chat/completions`, {
		method: 'POST',
	});

	const text = await response.text();
	server.close();
	t.is(text, 'data: [DONE]');
});

test('createUndiciFetch does not corrupt multi-byte characters split across chunks', async t => {
	const http = await import('node:http');
	const emojiBytes = new TextEncoder().encode('👋');
	const firstHalf = emojiBytes.subarray(0, 2);
	const secondHalf = emojiBytes.subarray(2, 4);

	const server = http.createServer((req, res) => {
		res.writeHead(200, {'Content-Type': 'text/event-stream'});
		res.write('data: ');
		res.write(firstHalf);
		setTimeout(() => {
			res.write(secondHalf);
			setTimeout(() => {
				res.end('\n\ndata:  [DONE]');
			}, 10);
		}, 10);
	});

	await new Promise<void>((resolve) => server.listen(0, resolve));
	const port = (server.address() as any).port;

	const agent = new Agent();
	const fetchFn = createUndiciFetch(agent);
	const response = await fetchFn(`http://localhost:${port}/v1/chat/completions`, {
		method: 'POST',
	});

	const text = await response.text();
	server.close();
	t.is(text, 'data: 👋\n\ndata: [DONE]');
});

function sseEvent(value: unknown): string {
	return `data: ${JSON.stringify(value)}\n\n`;
}

async function runNormalizer(chunks: string[]): Promise<string> {
	const encoder = new TextEncoder();
	const source = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});

	const reader = source
		.pipeThrough(createReasoningItemNormalizer())
		.getReader();
	const decoder = new TextDecoder();
	let output = '';
	for (;;) {
		const {done, value} = await reader.read();
		if (done) {
			break;
		}
		output += decoder.decode(value, {stream: true});
	}
	return output + decoder.decode();
}

function eventSummary(sse: string): string[] {
	return sse
		.split('\n\n')
		.filter(block => block.startsWith('data: '))
		.map(block => block.slice(6))
		.filter(payload => payload !== '[DONE]')
		.map(payload => {
			const value = JSON.parse(payload);
			return `${value.type}:${value.item?.id ?? value.item_id}`;
		});
}

test('createReasoningItemNormalizer maps a rotated item_id back to the item at that output_index', async t => {
	const output = await runNormalizer([
		sseEvent({
			type: 'response.output_item.added',
			output_index: 0,
			item: {id: 'rs_A', type: 'reasoning', encrypted_content: null},
		}),
		sseEvent({
			type: 'response.reasoning_summary_part.added',
			item_id: 'rs_B',
			output_index: 0,
			summary_index: 1,
		}),
		sseEvent({
			type: 'response.output_item.done',
			output_index: 0,
			item: {id: 'rs_C', type: 'reasoning', encrypted_content: null},
		}),
	]);

	t.deepEqual(eventSummary(output), [
		'response.output_item.added:rs_A',
		'response.reasoning_summary_part.added:rs_A',
		'response.output_item.done:rs_A',
	]);
});

test('createReasoningItemNormalizer keeps rotated ids on separate output_index values apart', async t => {
	const output = await runNormalizer([
		sseEvent({
			type: 'response.output_item.added',
			output_index: 0,
			item: {id: 'rs_A', type: 'reasoning', encrypted_content: null},
		}),
		sseEvent({
			type: 'response.output_item.added',
			output_index: 1,
			item: {id: 'rs_B', type: 'reasoning', encrypted_content: null},
		}),
		sseEvent({
			type: 'response.reasoning_summary_part.added',
			item_id: 'rs_rotated',
			output_index: 1,
			summary_index: 1,
		}),
	]);

	t.deepEqual(eventSummary(output), [
		'response.output_item.added:rs_A',
		'response.output_item.added:rs_B',
		'response.reasoning_summary_part.added:rs_B',
	]);
});

test('createReasoningItemNormalizer announces reasoning items that were never added', async t => {
	const output = await runNormalizer([
		sseEvent({
			type: 'response.reasoning_summary_part.done',
			item_id: 'rs_1',
			output_index: 0,
			summary_index: 0,
			part: {type: 'summary_text', text: 'thinking'},
		}),
		sseEvent({
			type: 'response.output_item.done',
			output_index: 1,
			item: {id: 'rs_2', type: 'reasoning', encrypted_content: null},
		}),
	]);

	t.deepEqual(eventSummary(output), [
		'response.output_item.added:rs_1',
		'response.reasoning_summary_part.done:rs_1',
		'response.output_item.added:rs_2',
		'response.output_item.done:rs_2',
	]);
});

test('createReasoningItemNormalizer leaves well-formed streams unchanged', async t => {
	const stream = [
		sseEvent({
			type: 'response.output_item.added',
			output_index: 0,
			item: {id: 'rs_1', type: 'reasoning', encrypted_content: null},
		}),
		sseEvent({
			type: 'response.reasoning_summary_part.added',
			item_id: 'rs_1',
			output_index: 0,
			summary_index: 1,
		}),
		sseEvent({
			type: 'response.output_item.done',
			output_index: 0,
			item: {id: 'rs_1', type: 'reasoning', encrypted_content: null},
		}),
		'data: [DONE]\n\n',
	];

	const output = await runNormalizer(stream);

	t.is(output, stream.join(''));
});

test('createReasoningItemNormalizer normalizes events split across chunks', async t => {
	const event = sseEvent({
		type: 'response.reasoning_summary_part.added',
		item_id: 'rs_1',
		output_index: 0,
		summary_index: 1,
	});
	const chunks: string[] = [];
	for (let i = 0; i < event.length; i += 7) {
		chunks.push(event.slice(i, i + 7));
	}

	const output = await runNormalizer(chunks);

	t.deepEqual(eventSummary(output), [
		'response.output_item.added:rs_1',
		'response.reasoning_summary_part.added:rs_1',
	]);
});

function framedEvent(value: {type: string}, eol: string): string {
	return `event: ${value.type}${eol}data: ${JSON.stringify(value)}${eol}${eol}`;
}

async function runNormalizerChunks(chunks: string[]): Promise<string[]> {
	const encoder = new TextEncoder();
	const source = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});

	const reader = source
		.pipeThrough(createReasoningItemNormalizer())
		.getReader();
	const decoder = new TextDecoder();
	const output: string[] = [];
	for (;;) {
		const {done, value} = await reader.read();
		if (done) {
			break;
		}
		output.push(decoder.decode(value, {stream: true}));
	}
	return output;
}

/** Framing-agnostic view of the output, so assertions don't assume LF or bare `data:`. */
function framedSummary(sse: string): string[] {
	return sse
		.split(/\r\n\r\n|\n\n|\r\r/)
		.map(block =>
			block
				.split(/\r\n|\n|\r/)
				.filter(line => line.startsWith('data:'))
				.map(line => line.slice(5).trim())
				.join(''),
		)
		.filter(payload => payload.length > 0 && payload !== '[DONE]')
		.map(payload => {
			const value = JSON.parse(payload);
			return `${value.type}:${value.item?.id ?? value.item_id}`;
		});
}

const ADDED_RS_A = {
	type: 'response.output_item.added',
	output_index: 0,
	item: {id: 'rs_A', type: 'reasoning'},
};

const SUMMARY_RS_B = {
	type: 'response.reasoning_summary_part.added',
	output_index: 0,
	item_id: 'rs_B',
};

test('createReasoningItemNormalizer rewrites rotated ids in event: framed streams', async t => {
	const output = await runNormalizer([
		framedEvent(ADDED_RS_A, '\n'),
		framedEvent(SUMMARY_RS_B, '\n'),
	]);

	t.deepEqual(framedSummary(output), [
		'response.output_item.added:rs_A',
		'response.reasoning_summary_part.added:rs_A',
	]);
	// The `event:` line has to survive the rewrite.
	t.true(output.includes('event: response.reasoning_summary_part.added'));
});

test('createReasoningItemNormalizer announces never-added items in event: framed streams', async t => {
	const output = await runNormalizer([framedEvent(SUMMARY_RS_B, '\n')]);

	t.deepEqual(framedSummary(output), [
		'response.output_item.added:rs_B',
		'response.reasoning_summary_part.added:rs_B',
	]);
});

test('createReasoningItemNormalizer normalizes CRLF framed streams', async t => {
	const output = await runNormalizer([
		framedEvent(ADDED_RS_A, '\r\n'),
		framedEvent(SUMMARY_RS_B, '\r\n'),
	]);

	t.deepEqual(framedSummary(output), [
		'response.output_item.added:rs_A',
		'response.reasoning_summary_part.added:rs_A',
	]);
	t.true(output.includes('\r\n\r\n'));
});

test('createReasoningItemNormalizer emits CRLF events as they arrive', async t => {
	const chunks = await runNormalizerChunks([
		framedEvent(ADDED_RS_A, '\r\n'),
		framedEvent(SUMMARY_RS_B, '\r\n'),
	]);

	// Both events must land before close; buffering the whole body until
	// flush() would stall streaming output.
	t.true(chunks.length >= 2);
});

test('createReasoningItemNormalizer normalizes a trailing event with no separator', async t => {
	const output = await runNormalizer([
		`data: ${JSON.stringify(SUMMARY_RS_B)}`,
	]);

	t.deepEqual(framedSummary(output), [
		'response.output_item.added:rs_B',
		'response.reasoning_summary_part.added:rs_B',
	]);
});

test('createReasoningItemNormalizer leaves unannounced events without an output_index alone', async t => {
	const input = sseEvent({
		type: 'response.reasoning_summary_part.added',
		item_id: 'rs_B',
	});

	// A synthetic announcement needs output_index to pass the SDK's schema;
	// without one, passing the event through is the only safe move.
	t.is(await runNormalizer([input]), input);
});

test('createReasoningItemNormalizer handles a CRLF separator split across chunks', async t => {
	const stream =
		framedEvent(ADDED_RS_A, '\r\n') + framedEvent(SUMMARY_RS_B, '\r\n');
	// Cut mid-separator, so one chunk ends on "\r\n\r" and the next opens "\n".
	const cut = stream.indexOf('\r\n\r\n') + 3;
	const output = await runNormalizer([
		stream.slice(0, cut),
		stream.slice(cut),
	]);

	t.deepEqual(framedSummary(output), [
		'response.output_item.added:rs_A',
		'response.reasoning_summary_part.added:rs_A',
	]);
	t.true(output.includes('\r\n\r\n'));
});
