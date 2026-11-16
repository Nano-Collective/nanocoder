import test from 'ava';
import type {AIProviderConfig} from '@/types/config';
import {
	resetSessionContextLimit,
	resolveModelContextLimit,
	setSessionContextLimit,
} from './models-dev-client.js';
import {
	detectServerKinds,
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
}

let calls: Call[] = [];

type Handler = (call: Call) => unknown;

function mockFetch(handler: Handler): void {
	calls = [];
	globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
		const call: Call = {
			url: String(input),
			method: init?.method ?? 'GET',
			body: typeof init?.body === 'string' ? init.body : undefined,
		};
		calls.push(call);
		const result = handler(call);
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

test.serial('ollama: falls back to <arch>.context_length when num_ctx is unset', async t => {
	mockFetch(() => ({
		parameters: 'stop "<|eot|>"',
		model_info: {'general.architecture': 'qwen3', 'qwen3.context_length': 40960},
	}));
	t.is(
		await probeServerContextLimit(
			provider('http://localhost:11434/v1'),
			'qwen3:8b',
		),
		40960,
	);
});

test('parseOllamaShow rejects malformed payloads', t => {
	t.is(parseOllamaShow(null), null);
	t.is(parseOllamaShow({parameters: 'num_ctx abc', model_info: {}}), null);
	t.is(parseOllamaShow({model_info: {'x.context_length': 'big'}}), null);
	t.is(parseOllamaShow({model_info: {'x.context_length': -5}}), null);
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

test.serial('unclear local server is probed in bounded order until one answers', async t => {
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
	t.deepEqual(
		calls.map(c => c.url),
		[
			'http://localhost:9999/api/show',
			'http://localhost:9999/props',
			'http://localhost:9999/v1/models',
		],
	);
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
