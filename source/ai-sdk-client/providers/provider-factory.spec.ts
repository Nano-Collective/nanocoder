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

test('createReasoningItemNormalizer announces reasoning items with a rotated item_id', async t => {
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
