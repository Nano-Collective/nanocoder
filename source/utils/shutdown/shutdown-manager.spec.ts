import test from 'ava';
import {
	getShutdownManager,
	resetShutdownManager,
	ShutdownManager,
} from './shutdown-manager';

// Stub process.exit to prevent tests from actually exiting
let exitCalled: number | null = null;
const originalExit = process.exit;

test.beforeEach(() => {
	resetShutdownManager();
	exitCalled = null;
	// biome-ignore lint/suspicious/noExplicitAny: test stub
	process.exit = ((code?: number) => {
		exitCalled = code ?? 0;
	}) as any;
});

test.afterEach(() => {
	resetShutdownManager();
	process.exit = originalExit;
});

test.serial('getShutdownManager returns singleton', (t) => {
	const a = getShutdownManager();
	const b = getShutdownManager();
	t.is(a, b);
});

test.serial('resetShutdownManager creates new instance', (t) => {
	const a = getShutdownManager();
	resetShutdownManager();
	const b = getShutdownManager();
	t.not(a, b);
});

test.serial('handlers run in priority order (ascending)', async (t) => {
	const order: string[] = [];
	const manager = getShutdownManager();

	manager.register({
		name: 'high',
		priority: 100,
		handler: async () => {
			order.push('high');
		},
	});
	manager.register({
		name: 'low',
		priority: 10,
		handler: async () => {
			order.push('low');
		},
	});
	manager.register({
		name: 'mid',
		priority: 50,
		handler: async () => {
			order.push('mid');
		},
	});

	await manager.gracefulShutdown(0);

	t.deepEqual(order, ['low', 'mid', 'high']);
	t.is(exitCalled, 0);
});

test.serial('failing handler does not block subsequent handlers', async (t) => {
	const order: string[] = [];
	const manager = getShutdownManager();

	manager.register({
		name: 'first',
		priority: 10,
		handler: async () => {
			order.push('first');
		},
	});
	manager.register({
		name: 'failing',
		priority: 20,
		handler: async () => {
			throw new Error('boom');
		},
	});
	manager.register({
		name: 'last',
		priority: 30,
		handler: async () => {
			order.push('last');
		},
	});

	await manager.gracefulShutdown(0);

	t.deepEqual(order, ['first', 'last']);
	t.is(exitCalled, 0);
});

test.serial('re-entrant guard prevents double shutdown', async (t) => {
	let callCount = 0;
	const manager = getShutdownManager();

	manager.register({
		name: 'counter',
		priority: 10,
		handler: async () => {
			callCount++;
		},
	});

	// Call gracefulShutdown twice concurrently
	await Promise.all([
		manager.gracefulShutdown(0),
		manager.gracefulShutdown(0),
	]);

	t.is(callCount, 1);
});

test.serial('timeout safety net forces exit', async (t) => {
	const manager = new ShutdownManager({timeoutMs: 50});

	// biome-ignore lint/suspicious/noExplicitAny: test stub
	process.exit = ((code?: number) => {
		exitCalled = code ?? 0;
	}) as any;

	manager.register({
		name: 'slow',
		priority: 10,
		handler: () =>
			new Promise((resolve) => {
				setTimeout(resolve, 5000);
			}),
	});

	await manager.gracefulShutdown(1);

	t.is(exitCalled, 1);

	// Clean up the manager's signal handlers
	manager.reset();
});

test.serial('unregister removes a handler', async (t) => {
	const order: string[] = [];
	const manager = getShutdownManager();

	manager.register({
		name: 'kept',
		priority: 10,
		handler: async () => {
			order.push('kept');
		},
	});
	manager.register({
		name: 'removed',
		priority: 20,
		handler: async () => {
			order.push('removed');
		},
	});

	manager.unregister('removed');
	await manager.gracefulShutdown(0);

	t.deepEqual(order, ['kept']);
});

test.serial('re-registering same name overwrites handler', async (t) => {
	const order: string[] = [];
	const manager = getShutdownManager();

	manager.register({
		name: 'service',
		priority: 10,
		handler: async () => {
			order.push('old');
		},
	});
	manager.register({
		name: 'service',
		priority: 10,
		handler: async () => {
			order.push('new');
		},
	});

	await manager.gracefulShutdown(0);

	t.deepEqual(order, ['new']);
});

test.serial('reset clears handlers and allows re-shutdown', async (t) => {
	const manager = getShutdownManager();
	let called = false;

	manager.register({
		name: 'test',
		priority: 10,
		handler: async () => {
			called = true;
		},
	});

	manager.reset();

	// After reset, isShuttingDown is false and handlers are cleared
	// Need to re-stub process.exit since reset removes signal handlers
	// biome-ignore lint/suspicious/noExplicitAny: test stub
	process.exit = ((code?: number) => {
		exitCalled = code ?? 0;
	}) as any;

	await manager.gracefulShutdown(0);

	t.false(called);
	t.is(exitCalled, 0);
});

test.serial('gracefulShutdown passes exit code', async (t) => {
	const manager = getShutdownManager();
	await manager.gracefulShutdown(42);
	t.is(exitCalled, 42);
});

test.serial('uses NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT env var', (t) => {
	const originalEnv = process.env.NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT;

	process.env.NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT = '10000';
	const manager = getShutdownManager();
	t.is(manager['timeoutMs'], 10000);

	process.env.NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT = originalEnv ?? '';
	resetShutdownManager();
});

test.serial('programmatic timeoutMs takes priority over env var', (t) => {
	const originalEnv = process.env.NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT;

	process.env.NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT = '5000';
	const manager = new ShutdownManager({timeoutMs: 15000});
	t.is(manager['timeoutMs'], 15000);

	process.env.NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT = originalEnv ?? '';
});

test.serial('invalid env var falls back to default', (t) => {
	const originalEnv = process.env.NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT;

	process.env.NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT = 'invalid';
	const manager = getShutdownManager();
	// parseInt('invalid') returns NaN, which should fall back to default
	t.is(manager['timeoutMs'], 5000);

	process.env.NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT = originalEnv ?? '';
	resetShutdownManager();
});
