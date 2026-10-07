import test from 'ava';
import {
	dispatchOllamaKeepAlive,
	resolveOllamaConnection,
	VramAllocator,
} from './vram-allocator';

test('VramAllocator initializes with default balanced strategy and idle phase', t => {
	const allocator = new VramAllocator();
	t.is(allocator.getCurrentPhase(), 'idle');
	t.is(allocator.getConfig().strategy, 'balanced');
	t.true(allocator.getConfig().unloadOnExecution);
});

test('VramAllocator tracks registered model roles', t => {
	const allocator = new VramAllocator();
	allocator.registerModel('deepseek-coder:33b', 'coder');
	allocator.registerModel('nomic-embed-text', 'embedder');

	const states = allocator.getResidencyStates();
	t.is(states.length, 2);
	t.is(states.find(s => s.model === 'deepseek-coder:33b')?.role, 'coder');
	t.is(states.find(s => s.model === 'nomic-embed-text')?.role, 'embedder');
});

test('VramAllocator phase transitions update current phase and residency', async t => {
	const allocator = new VramAllocator({strategy: 'balanced'});
	allocator.registerModel('deepseek-coder:33b', 'coder');
	allocator.registerModel('nomic-embed-text', 'embedder');

	// Transition to retrieval: pins embedders
	await allocator.transitionPhase('retrieval');
	t.is(allocator.getCurrentPhase(), 'retrieval');
	const embedder = allocator
		.getResidencyStates()
		.find(s => s.model === 'nomic-embed-text');
	t.true(embedder?.isLoaded);

	// Transition to generation: evicts embedder, pins coder
	await allocator.transitionPhase('generation', {model: 'deepseek-coder:33b'});
	t.is(allocator.getCurrentPhase(), 'generation');
	t.false(
		allocator
			.getResidencyStates()
			.find(s => s.model === 'nomic-embed-text')?.isLoaded,
	);
	t.true(
		allocator
			.getResidencyStates()
			.find(s => s.model === 'deepseek-coder:33b')?.isLoaded,
	);

	// Non-heavy tool during execution does NOT evict loaded models
	await allocator.transitionPhase('execution', {toolName: 'read_file'});
	t.is(allocator.getCurrentPhase(), 'execution');
	t.true(
		allocator
			.getResidencyStates()
			.find(s => s.model === 'deepseek-coder:33b')?.isLoaded,
	);

	// Heavy tool (execute_bash) evicts model
	await allocator.transitionPhase('execution', {toolName: 'execute_bash'});
	t.is(allocator.getCurrentPhase(), 'execution');
	t.false(
		allocator
			.getResidencyStates()
			.find(s => s.model === 'deepseek-coder:33b')?.isLoaded,
	);
});

test('VramAllocator respects disabled strategy', async t => {
	const allocator = new VramAllocator({strategy: 'disabled'});
	allocator.registerModel('my-model', 'coder');
	// Pre-set isLoaded = true to verify the disabled strategy early-returns without modifying state
	allocator.getResidencyStates()[0].isLoaded = true;

	await allocator.transitionPhase('generation', {model: 'my-model'});
	t.is(allocator.getCurrentPhase(), 'generation');
	// isLoaded remains true because allocator is disabled and did not run eviction or change state
	t.true(allocator.getResidencyStates()[0].isLoaded);
});

test('resolveOllamaConnection falls back to default 127.0.0.1:11434', t => {
	const conn = resolveOllamaConnection(undefined, 'unknown-model');
	t.is(conn.baseURL, 'http://127.0.0.1:11434');
	t.is(conn.apiKey, undefined);

	const customOverride = resolveOllamaConnection(
		undefined,
		undefined,
		'http://remote-ollama:11434',
	);
	t.is(customOverride.baseURL, 'http://remote-ollama:11434');
});

test.serial('dispatchOllamaKeepAlive formats URL and payload correctly', async t => {
	const originalFetch = globalThis.fetch;
	let capturedUrl = '';
	let capturedHeaders: Record<string, string> = {};
	let capturedBody = '';

	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		capturedUrl = url;
		capturedHeaders = (init?.headers as Record<string, string>) || {};
		capturedBody = String(init?.body || '');
		return {ok: true, status: 200} as Response;
	}) as typeof fetch;

	try {
		const result = await dispatchOllamaKeepAlive(
			'llama3.2:3b',
			'15m',
			'http://localhost:11434/v1',
		);
		t.true(result);
		t.is(capturedUrl, 'http://localhost:11434/api/generate');
		const body = JSON.parse(capturedBody);
		t.is(body.model, 'llama3.2:3b');
		t.is(body.keep_alive, '15m');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('dispatchOllamaKeepAlive includes Authorization header when apiKey is present', async t => {
	const originalFetch = globalThis.fetch;
	let capturedHeaders: Record<string, string> = {};

	globalThis.fetch = (async (_url: string, init?: RequestInit) => {
		capturedHeaders = (init?.headers as Record<string, string>) || {};
		return {ok: true, status: 200} as Response;
	}) as typeof fetch;

	try {
		const result = await dispatchOllamaKeepAlive('qwen2.5:7b', 0, {
			baseURL: 'https://ollama.proxy.corp/api',
			apiKey: 'secret-token-123',
		});
		t.true(result);
		t.is(capturedHeaders.Authorization, 'Bearer secret-token-123');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test.serial('dispatchOllamaKeepAlive returns false on network failure', async t => {
	const originalFetch = globalThis.fetch;

	globalThis.fetch = (async () => {
		throw new Error('Connection refused');
	}) as typeof fetch;

	try {
		const result = await dispatchOllamaKeepAlive('qwen2.5:7b', 0);
		t.false(result);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

