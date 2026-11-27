import test from 'ava';
import type {AIProviderConfig} from '@/types/config';
import {
	resetSessionContextLimit,
	resolveModelContextLimit,
	setSessionContextLimit,
} from './models-dev-client.js';
import {TIMEOUT_CONTEXT_PROBE_MS} from '@/constants';
import {
	detectServerKinds,
	parseOllamaPs,
	parseOllamaShow,
	probeServerContextLimit,
	resetServerContextProbeCache,
} from './server-context-probe.js';

console.log(`\nserver-context-probe.spec.ts`);

const realFetch = globalThis.fetch;

interface Call {
	url: string;
	method: string;
	body?: string;
	signal?: AbortSignal;
}

let calls: Call[] = [];

type Handler = (call: Call) => unknown;

const aborted: string[] = [];

/** Resolves with `value` after `ms`, or rejects when the request is aborted. */
function delayed(
	call: Call,
	ms: number,
	value: unknown,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			aborted.push(call.url);
			reject(new Error('aborted'));
		};
		const timer = setTimeout(() => {
			call.signal?.removeEventListener('abort', onAbort);
			resolve(value);
		}, ms);
		call.signal?.addEventListener('abort', onAbort);
	});
}

/** Never answers; only an abort ends it. */
function hang(call: Call): Promise<unknown> {
	return new Promise((_resolve, reject) => {
		call.signal?.addEventListener('abort', () => {
			aborted.push(call.url);
			reject(new Error('aborted'));
		});
	});
}

function mockFetch(handler: Handler): void {
	calls = [];
	aborted.length = 0;
	globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
		const call: Call = {
			url: String(input),
			method: init?.method ?? 'GET',
			body: typeof init?.body === 'string' ? init.body : undefined,
			signal: init?.signal ?? undefined,
		};
		calls.push(call);
		const result = await handler(call);
		if (result instanceof Error) {
			throw result;
		}
		if (typeof result === 'number') {
			return new Response('nope', {status: result});
		}
		return new Response(JSON.stringify(result), {status: 200});
	}) as typeof fetch;
}

function provider(baseURL: string, name = 'Test'): AIProviderConfig {
	return {name, type: 'openai', models: ['m'], config: {baseURL}};
}

test.beforeEach(() => {
	resetServerContextProbeCache();
	resetSessionContextLimit();
	delete process.env.NANOCODER_CONTEXT_LIMIT;
	calls = [];
});

test.afterEach.always(() => {
	globalThis.fetch = realFetch;
	resetServerContextProbeCache();
	resetSessionContextLimit();
});

test.serial('ollama: num_ctx from parameters wins over context_length', async t => {
	mockFetch(() => ({
		parameters: 'stop "<|eot|>"\nnum_ctx                        8192\ntemperature 0.7',
		model_info: {'llama.context_length': 131072},
	}));
	const limit = await probeServerContextLimit(
		provider('http://localhost:11434/v1', 'Ollama'),
		'llama3.1:8b',
	);
	t.is(limit, 8192);
	t.is(calls.length, 1);
	t.is(calls[0].url, 'http://localhost:11434/api/show');
	t.is(calls[0].method, 'POST');
	t.deepEqual(JSON.parse(calls[0].body ?? '{}'), {model: 'llama3.1:8b'});
});

test.serial('ollama: without num_ctx, uses context_length of the loaded model from /api/ps', async t => {
	mockFetch(call =>
		call.url.endsWith('/api/show')
			? {
					parameters: 'stop "<|eot|>"',
					model_info: {'qwen3.context_length': 40960},
				}
			: {
					models: [
						{name: 'other:7b', model: 'other:7b', context_length: 2048},
						{name: 'qwen3:8b', model: 'qwen3:8b', context_length: 4096},
					],
				},
	);
	t.is(
		await probeServerContextLimit(
			provider('http://localhost:11434/v1', 'Ollama'),
			'qwen3:8b',
		),
		4096,
	);
	t.deepEqual(
		calls.map(c => `${c.method} ${c.url}`),
		[
			'POST http://localhost:11434/api/show',
			'GET http://localhost:11434/api/ps',
		],
	);
});

test.serial('ollama: the trained context_length is never used', async t => {
	// Not loaded: /api/ps is empty, so there is no answer (the table applies).
	mockFetch(call =>
		call.url.endsWith('/api/show')
			? {model_info: {'llama.context_length': 131072}}
			: {models: []},
	);
	t.is(
		await probeServerContextLimit(
			provider('http://localhost:11434/v1', 'Ollama'),
			'llama3.1:8b',
		),
		null,
	);

	// Loaded but the server omits context_length (older Ollama): still null.
	mockFetch(call =>
		call.url.endsWith('/api/show')
			? {model_info: {'llama.context_length': 131072}}
			: {models: [{name: 'm2:latest', model: 'm2:latest'}]},
	);
	t.is(
		await probeServerContextLimit(
			provider('http://localhost:11434/v1', 'Ollama'),
			'm2',
		),
		null,
	);
});

test.serial('ollama: /api/ps matching of a model with another model loaded is null', async t => {
	mockFetch(call =>
		call.url.endsWith('/api/show')
			? {parameters: ''}
			: {models: [{name: 'other:7b', model: 'other:7b', context_length: 8192}]},
	);
	t.is(
		await probeServerContextLimit(
			provider('http://localhost:11434/v1', 'Ollama'),
			'qwen3:8b',
		),
		null,
	);
});

test.serial('ollama: explicit num_ctx wins and /api/ps is not queried', async t => {
	mockFetch(call =>
		call.url.endsWith('/api/show')
			? {parameters: 'num_ctx 16384'}
			: {models: [{name: 'm:latest', context_length: 4096}]},
	);
	t.is(
		await probeServerContextLimit(
			provider('http://localhost:11434/v1', 'Ollama'),
			'm',
		),
		16384,
	);
	t.is(calls.length, 1);
});

test.serial('ollama: /api/ps failure resolves to null', async t => {
	mockFetch(call => (call.url.endsWith('/api/show') ? {parameters: ''} : 500));
	t.is(
		await probeServerContextLimit(
			provider('http://localhost:11434/v1', 'Ollama'),
			'm',
		),
		null,
	);
});

test('parseOllamaPs tolerates tag variants and malformed payloads', t => {
	const body = {
		models: [{name: 'llama3:latest', model: 'llama3:latest', context_length: 4096}],
	};
	t.is(parseOllamaPs(body, 'llama3'), 4096);
	t.is(parseOllamaPs(body, 'llama3:latest'), 4096);
	t.is(parseOllamaPs(body, 'LLAMA3'), 4096);
	t.is(parseOllamaPs(body, 'llama3:8b'), null);
	// Matches on either the name or the model field.
	t.is(
		parseOllamaPs({models: [{model: 'hf.co/org/x:Q4', context_length: 2048}]}, 'hf.co/org/x:Q4'),
		2048,
	);
	t.is(parseOllamaPs({models: [{name: 'llama3', context_length: 1024}]}, 'llama3:latest'), 1024);
	t.is(parseOllamaPs(null, 'a'), null);
	t.is(parseOllamaPs({models: 'x'}, 'a'), null);
	t.is(parseOllamaPs({models: [null, {name: 'a', context_length: 'big'}]}, 'a'), null);
	t.is(parseOllamaPs({models: [{name: 'a', context_length: -1}]}, 'a'), null);
});

test.serial('llama.cpp: reads default_generation_settings.n_ctx from /props', async t => {
	mockFetch(() => ({default_generation_settings: {n_ctx: 16384}}));
	const limit = await probeServerContextLimit(
		provider('http://localhost:8080/v1', 'llama-cpp'),
		'anything',
	);
	t.is(limit, 16384);
	t.is(calls[0].url, 'http://localhost:8080/props');
	t.is(calls[0].method, 'GET');
});

test.serial('vLLM: reads max_model_len for the matching model id', async t => {
	mockFetch(() => ({
		data: [
			{id: 'other/model', max_model_len: 1024},
			{id: 'Qwen/Qwen3-8B', max_model_len: 32768},
		],
	}));
	const limit = await probeServerContextLimit(
		provider('http://gpu-box.local:8000/v1', 'vllm'),
		'Qwen/Qwen3-8B',
	);
	t.is(limit, 32768);
	t.is(calls[0].url, 'http://gpu-box.local:8000/v1/models');
});

test.serial('vLLM: no matching model id yields null', async t => {
	mockFetch(() => ({data: [{id: 'other', max_model_len: 1024}]}));
	t.is(
		await probeServerContextLimit(
			provider('http://localhost:8000/v1', 'vllm'),
			'missing',
		),
		null,
	);
});

test.serial('unclear local server: all kinds are probed concurrently and a later kind can answer', async t => {
	mockFetch(call => {
		if (call.url.endsWith('/api/show')) return 404;
		if (call.url.endsWith('/props')) return 404;
		return {data: [{id: 'm', max_model_len: 4096}]};
	});
	const limit = await probeServerContextLimit(
		provider('http://localhost:9999/v1'),
		'm',
	);
	t.is(limit, 4096);
	t.deepEqual(calls.map(c => c.url).sort(), [
		'http://localhost:9999/api/show',
		'http://localhost:9999/props',
		'http://localhost:9999/v1/models',
	]);
});

test.serial('unclear local server: the first valid answer wins, others are aborted', async t => {
	mockFetch(call => {
		// Ollama would answer, but later than llama.cpp.
		if (call.url.endsWith('/api/show')) {
			return delayed(call, 300, {parameters: 'num_ctx 1111'});
		}
		if (call.url.endsWith('/props')) {
			return delayed(call, 10, {default_generation_settings: {n_ctx: 2222}});
		}
		return hang(call);
	});
	const started = Date.now();
	const limit = await probeServerContextLimit(
		provider('http://localhost:9999/v1'),
		'm',
	);
	t.is(limit, 2222);
	t.true(Date.now() - started < 250);
	t.deepEqual(aborted.sort(), [
		'http://localhost:9999/api/show',
		'http://localhost:9999/v1/models',
	]);
});

test.serial('unclear local server: an early failure does not mask a slower success', async t => {
	mockFetch(call => {
		if (call.url.endsWith('/api/show')) return new Error('refused');
		if (call.url.endsWith('/props')) return 404;
		return delayed(call, 40, {data: [{id: 'm', max_model_len: 8192}]});
	});
	t.is(
		await probeServerContextLimit(provider('http://localhost:9999/v1'), 'm'),
		8192,
	);
});

test.serial('unclear local server: when every kind hangs the probe returns within one overall cap', async t => {
	mockFetch(hang);
	const started = Date.now();
	const limit = await probeServerContextLimit(
		provider('http://localhost:9999/v1'),
		'm',
	);
	const elapsed = Date.now() - started;
	t.is(limit, null);
	t.is(calls.length, 3);
	// Sequential probing would take ~3x the cap.
	t.true(elapsed >= TIMEOUT_CONTEXT_PROBE_MS - 100, `returned early: ${elapsed}ms`);
	t.true(elapsed < TIMEOUT_CONTEXT_PROBE_MS + 700, `took too long: ${elapsed}ms`);
	t.is(aborted.length, 3);
});

test.serial('a hinted server type stays a single request', async t => {
	mockFetch(() => ({data: [{id: 'm', max_model_len: 4096}]}));
	await probeServerContextLimit(provider('http://localhost:8000/v1', 'vllm'), 'm');
	t.is(calls.length, 1);
});

test('detectServerKinds hints and gating', t => {
	t.deepEqual(detectServerKinds(provider('http://localhost:11434/v1')), [
		'ollama',
	]);
	t.deepEqual(detectServerKinds(provider('http://10.0.0.5:1234/v1')), [
		'ollama',
		'llama-cpp',
		'vllm',
	]);
	// Unhinted remote hosts (hosted APIs) are not probed.
	t.deepEqual(detectServerKinds(provider('https://api.openai.com/v1')), []);
	// Non OpenAI-compatible SDKs are not probed.
	t.deepEqual(
		detectServerKinds({
			...provider('http://localhost:11434/v1'),
			sdkProvider: 'anthropic',
		}),
		[],
	);
	t.deepEqual(detectServerKinds({...provider('nonsense')}), []);
});

test.serial('failures never throw and resolve to null (HTTP error, network error, bad JSON)', async t => {
	const config = provider('http://localhost:11434/v1', 'Ollama');

	mockFetch(() => 500);
	t.is(await probeServerContextLimit(config, 'a'), null);

	mockFetch(() => new Error('ECONNREFUSED'));
	t.is(await probeServerContextLimit(config, 'b'), null);

	mockFetch(() => 'not-an-object');
	t.is(await probeServerContextLimit(config, 'c'), null);

	t.is(await probeServerContextLimit(undefined, 'd'), null);
});

test.serial('results are cached per base URL and model, including misses', async t => {
	mockFetch(() => ({parameters: 'num_ctx 4096'}));
	const config = provider('http://localhost:11434/v1', 'Ollama');

	const [a, b] = await Promise.all([
		probeServerContextLimit(config, 'm1'),
		probeServerContextLimit(config, 'm1'),
	]);
	t.is(a, 4096);
	t.is(b, 4096);
	await probeServerContextLimit(config, 'm1');
	t.is(calls.length, 1);

	// A different model is probed separately.
	await probeServerContextLimit(config, 'm2');
	t.is(calls.length, 2);

	// A failure is cached too, so a dead server is not re-probed per response.
	mockFetch(() => new Error('down'));
	const dead = provider('http://localhost:11435/v1', 'Ollama');
	await probeServerContextLimit(dead, 'm1');
	await probeServerContextLimit(dead, 'm1');
	t.is(calls.length, 1);
});

test.serial('resolveModelContextLimit prefers the server value over models.dev and the built-in table', async t => {
	mockFetch(() => ({parameters: 'num_ctx 8192'}));
	const resolved = await resolveModelContextLimit('llama3.1:8b', {
		providerConfig: provider('http://localhost:11434/v1', 'Ollama'),
	});
	t.deepEqual(resolved, {limit: 8192, source: 'server'});
});

test.serial('resolveModelContextLimit: --context-max (session) wins and skips the probe', async t => {
	mockFetch(() => ({parameters: 'num_ctx 8192'}));
	setSessionContextLimit(50_000);
	const resolved = await resolveModelContextLimit('llama3.1:8b', {
		providerConfig: provider('http://localhost:11434/v1', 'Ollama'),
	});
	t.deepEqual(resolved, {limit: 50_000, source: 'session'});
	t.is(calls.length, 0);
});

test.serial('resolveModelContextLimit: configured contextWindow and env var beat the server', async t => {
	mockFetch(() => ({parameters: 'num_ctx 8192'}));
	const configured = await resolveModelContextLimit('llama3.1:8b', {
		providerConfig: {
			...provider('http://localhost:11434/v1', 'Ollama'),
			contextWindow: 20_000,
		},
	});
	t.deepEqual(configured, {limit: 20_000, source: 'provider-config'});

	process.env.NANOCODER_CONTEXT_LIMIT = '30000';
	const env = await resolveModelContextLimit('llama3.1:8b', {
		providerConfig: provider('http://localhost:11434/v1', 'Ollama'),
	});
	t.deepEqual(env, {limit: 30_000, source: 'env'});
	t.is(calls.length, 0);
});

test.serial('resolveModelContextLimit falls back to today\'s behaviour when the probe fails', async t => {
	mockFetch(() => new Error('ECONNREFUSED'));
	const resolved = await resolveModelContextLimit('llama3.1:8b', {
		providerConfig: provider('http://localhost:11434/v1', 'Ollama'),
	});
	t.is(resolved.source, 'model-lookup');
	t.true((resolved.limit ?? 0) > 0);
});
