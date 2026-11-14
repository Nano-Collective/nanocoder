import type {Client} from '@modelcontextprotocol/sdk/client/index.js';
import test from 'ava';
import {FakeClock, settle} from '@/test-utils/fake-clock';
import type {MCPHealthChange, MCPServer} from '@/types/index';
import {
	backoffDelay,
	type LifecycleTransport,
	MCPHealthMonitor,
} from './health-monitor';

console.log('\nhealth-monitor.spec.ts');

const NAME = 'srv';

type FakeSdkClient = {
	pings: number;
	closed: boolean;
	ping?: (options?: unknown) => Promise<unknown>;
	close(): Promise<void>;
};

const fakeClient = (
	ping?: (call: number, options?: unknown) => Promise<unknown>,
): FakeSdkClient => {
	const client: FakeSdkClient = {
		pings: 0,
		closed: false,
		async close() {
			client.closed = true;
		},
	};
	if (ping) {
		client.ping = options => {
			client.pings++;
			return ping(client.pings, options);
		};
	}
	return client;
};

const asClient = (client: FakeSdkClient) => client as unknown as Client;

const sessionNotFound = () =>
	Object.assign(new Error('Session not found'), {code: 404});

/**
 * A monitor wired to an in-memory host. `reconnect` registers a fresh client
 * and marks it connected, as MCPClient.connectToServer does, unless the test
 * overrides it.
 */
const harness = (config: Partial<MCPServer> = {}) => {
	const clock = new FakeClock();
	const state = {
		closing: new Set<string>(),
		clients: new Map<string, FakeSdkClient>(),
		configs: new Map<string, MCPServer>([
			[NAME, {name: NAME, transport: 'http', url: 'http://x', ...config}],
		]),
		catalogCleared: 0,
		rediscovered: 0,
		reconnects: 0,
		forgotten: [] as string[],
		epoch: 0,
		rediscover: async (): Promise<number> => 1,
		reconnect: async (_config: MCPServer): Promise<void> => {
			state.clients.set(NAME, fakeClient(async () => ({})));
			monitor.setStatus(NAME, 'connected');
		},
	};
	const monitor = new MCPHealthMonitor(
		{
			isClosing: name => state.closing.has(name),
			getClient: name => {
				const client = state.clients.get(name);
				return client ? asClient(client) : undefined;
			},
			getConfig: name => state.configs.get(name),
			clearCatalog: () => {
				state.catalogCleared++;
			},
			rediscover: () => {
				state.rediscovered++;
				return state.rediscover();
			},
			reconnect: config => {
				state.reconnects++;
				return state.reconnect(config);
			},
			forget: async name => {
				state.forgotten.push(name);
			},
			lifecycleEpoch: () => state.epoch,
		},
		clock,
	);
	const changes: MCPHealthChange[] = [];
	monitor.onChange(change => changes.push(change));

	/** Register `client` as the server's connection and start watching it. */
	const watch = (
		client: FakeSdkClient,
		options: {
			status?: 'connected' | 'unhealthy';
			interval?: number;
			transport?: LifecycleTransport;
			pingOptions?: {timeout: number};
		} = {},
	) => {
		const transport = options.transport ?? {};
		state.clients.set(NAME, client);
		monitor.setStatus(NAME, options.status ?? 'connected');
		changes.length = 0;
		monitor.watch(
			NAME,
			asClient(client),
			transport,
			options.interval ?? 10,
			options.pingOptions,
		);
		return transport;
	};

	return {clock, state, monitor, changes, watch};
};

test('backoffDelay doubles per failure, capped at 8x and five minutes', t => {
	t.is(backoffDelay(10, 0), 10);
	t.is(backoffDelay(10, 1), 10);
	t.is(backoffDelay(10, 2), 20);
	t.is(backoffDelay(10, 3), 40);
	t.is(backoffDelay(10, 4), 80);
	t.is(backoffDelay(10, 10), 80);
	t.is(backoffDelay(100_000, 4), 300_000);
});

test('setStatus reports changes but not the first connect or a repeat', t => {
	const {monitor, changes} = harness();
	monitor.setStatus(NAME, 'connected');
	t.deepEqual(changes, []);
	monitor.setStatus(NAME, 'unhealthy', new Error('down'));
	monitor.setStatus(NAME, 'unhealthy', new Error('down'));
	monitor.setStatus(NAME, 'connected');
	t.deepEqual(
		changes.map(change => [change.status, change.error]),
		[
			['unhealthy', 'down'],
			['connected', undefined],
		],
	);
	t.is(monitor.getError(NAME), undefined);
});

test('one missed ping keeps a server; two mark it unhealthy and clear its catalog', async t => {
	const {clock, state, monitor, changes, watch} = harness();
	const client = fakeClient(async () => {
		throw new Error('server stopped responding');
	});
	watch(client);
	t.deepEqual(clock.pendingDelays(), [10]);

	await clock.advance(10);
	t.is(client.pings, 1);
	t.is(monitor.getStatus(NAME), 'connected');
	t.is(monitor.getFailureCount(NAME), 1);
	t.is(state.catalogCleared, 0);

	await clock.advance(10);
	t.is(client.pings, 2);
	t.is(monitor.getStatus(NAME), 'unhealthy');
	t.is(monitor.getError(NAME), 'server stopped responding');
	t.is(state.catalogCleared, 1);
	t.deepEqual(
		changes.map(change => change.status),
		['unhealthy'],
	);
});

test('pings back off exponentially and reset after recovery', async t => {
	// stdio, so an unhealthy server keeps being pinged rather than handed to
	// the reconnect loop.
	const {clock, state, monitor, watch} = harness({transport: 'stdio'});
	let failing = true;
	const client = fakeClient(async () => {
		if (failing) throw new Error('connection refused');
		return {};
	});
	watch(client);

	const delays: number[] = [];
	for (let i = 0; i < 4; i++) {
		delays.push(...clock.pendingDelays());
		await clock.advance(clock.pendingDelays()[0]);
	}
	delays.push(...clock.pendingDelays());
	t.deepEqual(delays, [10, 10, 20, 40, 80]);
	t.is(monitor.getStatus(NAME), 'unhealthy');
	t.is(monitor.getFailureCount(NAME), 4);
	t.false(monitor.isReconnectScheduled(NAME));

	failing = false;
	await clock.advance(80);
	t.is(monitor.getStatus(NAME), 'connected');
	t.is(monitor.getFailureCount(NAME), 0);
	t.is(state.rediscovered, 1);
	t.deepEqual(clock.pendingDelays(), [10]);
});

test('an unhealthy server whose ping succeeds is rediscovered and reconnected', async t => {
	const {clock, state, monitor, changes, watch} = harness();
	watch(
		fakeClient(async () => ({})),
		{status: 'unhealthy'},
	);
	await clock.advance(10);
	t.is(state.rediscovered, 1);
	t.is(monitor.getStatus(NAME), 'connected');
	t.deepEqual(
		changes.map(change => change.status),
		['connected'],
	);
});

test('JSON-RPC MethodNotFound counts as alive and recovers the server', async t => {
	const {clock, state, monitor, watch} = harness({transport: 'stdio'});
	watch(
		fakeClient(async () => {
			throw Object.assign(new Error('Method not found'), {code: -32601});
		}),
		{status: 'unhealthy'},
	);
	await clock.advance(10);
	t.is(state.rediscovered, 1);
	t.is(monitor.getStatus(NAME), 'connected');
	t.is(monitor.getFailureCount(NAME), 0);
});

test('a failed rediscovery leaves the server unhealthy', async t => {
	const {clock, state, monitor, watch} = harness({transport: 'stdio'});
	state.rediscover = async () => {
		throw new Error('tools/list failed');
	};
	watch(
		fakeClient(async () => ({})),
		{status: 'unhealthy'},
	);
	await clock.advance(10);
	t.is(state.rediscovered, 1);
	t.is(monitor.getStatus(NAME), 'unhealthy');
});

test('a closed transport marks the server unhealthy and hands it to the reconnect loop', async t => {
	const {clock, state, monitor, changes, watch} = harness({
		transport: 'stdio',
		healthCheckInterval: 60_000,
	});
	let previousCloseCalls = 0;
	const first = fakeClient(async () => ({}));
	const transport = watch(first, {
		interval: 60_000,
		transport: {
			onclose: () => {
				previousCloseCalls++;
			},
		},
	});
	t.true(monitor.isPingScheduled(NAME));

	transport.onclose?.();
	t.is(previousCloseCalls, 1, 'the transport\'s own handler still runs');
	t.is(monitor.getStatus(NAME), 'unhealthy');
	t.is(monitor.getError(NAME), 'MCP transport closed');
	t.is(state.catalogCleared, 1);
	t.false(monitor.isPingScheduled(NAME), 'pings stop after a close');
	t.true(monitor.isReconnectScheduled(NAME));
	t.deepEqual(clock.pendingDelays(), [60_000]);

	await clock.advance(60_000);
	t.is(state.reconnects, 1);
	t.is(monitor.getStatus(NAME), 'connected');
	t.is(monitor.getReconnectAttempts(NAME), 0);
	t.false(monitor.isReconnectScheduled(NAME));
	t.true(first.closed, 'the replaced client is closed');
	t.deepEqual(
		changes.map(change => change.status),
		['unhealthy', 'connected'],
	);

	// A late event from the replaced client must not touch the new one.
	transport.onclose?.();
	t.is(monitor.getStatus(NAME), 'connected');
	t.false(monitor.isReconnectScheduled(NAME));
});

test('a failed reconnect is retried with backoff', async t => {
	const {clock, state, monitor, watch} = harness({
		transport: 'stdio',
		healthCheckInterval: 10,
	});
	const succeed = state.reconnect;
	state.reconnect = async () => {
		throw new Error('spawn failed');
	};
	watch(fakeClient(async () => ({}))).onclose?.();
	t.deepEqual(clock.pendingDelays(), [10]);

	await clock.advance(10);
	t.is(state.reconnects, 1);
	t.is(monitor.getReconnectAttempts(NAME), 1);
	t.is(monitor.getStatus(NAME), 'unhealthy');
	t.deepEqual(clock.pendingDelays(), [20]);

	await clock.advance(20);
	t.is(state.reconnects, 2);
	t.is(monitor.getReconnectAttempts(NAME), 2);
	t.deepEqual(clock.pendingDelays(), [40]);

	state.reconnect = succeed;
	await clock.advance(40);
	t.is(monitor.getStatus(NAME), 'connected');
	t.is(monitor.getReconnectAttempts(NAME), 0);
});

test('reconnect uses the default cadence when periodic checks are disabled', async t => {
	const {clock, watch} = harness({healthCheckInterval: 0});
	watch(fakeClient(async () => ({})), {interval: 0}).onclose?.();
	t.deepEqual(clock.pendingDelays(), [30_000]);
});

test('stop cancels a pending reconnect', t => {
	const {clock, monitor, watch} = harness({transport: 'stdio'});
	watch(fakeClient(async () => ({}))).onclose?.();
	t.true(monitor.isReconnectScheduled(NAME));
	monitor.stop(NAME);
	t.false(monitor.isReconnectScheduled(NAME));
	t.is(clock.pendingCount, 0);
});

test('a reconnect that completes after shutdown is undone', async t => {
	const {clock, state, monitor, watch} = harness({transport: 'stdio'});
	const succeed = state.reconnect;
	state.reconnect = async config => {
		await succeed(config);
		state.epoch++; // the owner shut down while this was connecting
	};
	watch(fakeClient(async () => ({}))).onclose?.();
	await clock.advance(30_000);
	t.deepEqual(state.forgotten, [NAME]);
	t.is(monitor.getReconnectAttempts(NAME), 0);
});

test('a lost remote session is reconnected on the first failed ping', async t => {
	const {clock, monitor, watch} = harness();
	watch(
		fakeClient(async () => {
			throw sessionNotFound();
		}),
	);
	await clock.advance(10);
	t.is(monitor.getStatus(NAME), 'unhealthy');
	t.false(monitor.isPingScheduled(NAME));
	t.true(monitor.isReconnectScheduled(NAME));
	t.is(monitor.getFailureCount(NAME), 0);
});

test('a remote server whose recovery ping fails is handed to the reconnect loop', async t => {
	const {clock, monitor, watch} = harness();
	watch(
		fakeClient(async () => {
			throw new TypeError('fetch failed');
		}),
		{status: 'unhealthy'},
	);
	await clock.advance(10);
	t.false(monitor.isPingScheduled(NAME));
	t.true(monitor.isReconnectScheduled(NAME));
});

test('an unhealthy stdio server keeps being pinged instead of reconnected', async t => {
	const {clock, monitor, watch} = harness({transport: 'stdio'});
	const client = fakeClient(async () => {
		throw sessionNotFound();
	});
	watch(client, {status: 'unhealthy', interval: 5});
	await clock.advance(5);
	await clock.advance(5);
	await clock.advance(10);
	t.is(client.pings, 3);
	t.false(monitor.isReconnectScheduled(NAME));
	t.true(monitor.isPingScheduled(NAME));
});

for (const pingFails of [false, true]) {
	test(`transport errors share one liveness ping that ${pingFails ? 'counts a failure without dropping the server' : 'keeps the server'}`, async t => {
		const {state, monitor, watch} = harness();
		let finishPing!: () => void;
		const pendingPing = new Promise<void>(resolve => {
			finishPing = resolve;
		});
		let pingOptions: unknown;
		let previousErrorCalls = 0;
		const client = fakeClient(async (_call, options) => {
			pingOptions = options;
			await pendingPing;
			if (pingFails) throw new Error('ping failed');
		});
		const transport = watch(client, {
			interval: 60_000,
			transport: {
				onerror: () => {
					previousErrorCalls++;
				},
			},
		});
		transport.onerror?.(new Error('recoverable SSE interruption'));
		transport.onerror?.(new Error('another transport error'));
		await settle();
		t.is(previousErrorCalls, 2);
		t.is(client.pings, 1, 'overlapping errors share one liveness check');
		t.deepEqual(pingOptions, {timeout: 10_000});

		finishPing();
		await settle();
		t.is(monitor.getStatus(NAME), 'connected');
		t.is(state.catalogCleared, 0);
		t.is(monitor.getFailureCount(NAME), pingFails ? 1 : 0);
	});
}

test('liveness pings use the connect timeout when one is configured', async t => {
	const {clock, watch} = harness();
	let pingOptions: unknown;
	watch(
		fakeClient(async (_call, options) => {
			pingOptions = options;
		}),
		{pingOptions: {timeout: 1234}},
	);
	await clock.advance(10);
	t.deepEqual(pingOptions, {timeout: 1234});
});

test('with interval 0 nothing is scheduled and transport errors do not ping', async t => {
	const {clock, monitor, watch} = harness();
	const client = fakeClient(async () => {
		throw new Error('ping failed');
	});
	const transport = watch(client, {interval: 0});
	t.is(clock.pendingCount, 0);
	transport.onerror?.(new Error('transport error'));
	transport.onerror?.(new Error('transport error'));
	await settle();
	t.is(client.pings, 0);
	t.is(monitor.getStatus(NAME), 'connected');
});

test('no ping is sent while a request is in flight', async t => {
	const {clock, monitor, watch} = harness();
	const client = fakeClient(async () => {
		// A ping queued behind the slow call would time out.
		throw new Error('Request timed out');
	});
	watch(client);
	let finishCall!: () => void;
	const pending = monitor.trackInFlight(
		NAME,
		() =>
			new Promise<string>(resolve => {
				finishCall = () => resolve('done');
			}),
	);
	t.is(monitor.getInFlightCount(NAME), 1);

	await clock.advance(10);
	await clock.advance(10);
	t.is(client.pings, 0, 'no ping while the call is in flight');
	t.deepEqual(clock.pendingDelays(), [10], 'the check is rescheduled');

	finishCall();
	t.is(await pending, 'done');
	t.is(monitor.getInFlightCount(NAME), 0);
	await clock.advance(10);
	t.is(client.pings, 1);
});

test('events from a replaced client are ignored', async t => {
	const {clock, state, monitor, watch} = harness();
	const old = fakeClient(async () => {
		throw new Error('old session');
	});
	const transport = watch(old);
	state.clients.set(NAME, fakeClient(async () => ({})));

	transport.onclose?.();
	await clock.advance(10);
	t.is(old.pings, 0);
	t.is(monitor.getStatus(NAME), 'connected');
	t.false(monitor.isReconnectScheduled(NAME));
	t.is(clock.pendingCount, 0);
});

test('a ping that fails while the server is closing changes nothing', async t => {
	const {clock, state, monitor, changes, watch} = harness();
	let rejectPing!: (error: Error) => void;
	const client = fakeClient(
		() =>
			new Promise((_resolve, reject) => {
				rejectPing = reject;
			}),
	);
	watch(client, {interval: 60_000}).onerror?.(new Error('temporary error'));
	await settle();
	t.is(client.pings, 1);
	state.closing.add(NAME);
	monitor.stop(NAME);
	rejectPing(new Error('connection closed'));
	await settle();
	t.deepEqual(changes, []);
	t.is(monitor.getStatus(NAME), 'connected');
	t.is(clock.pendingCount, 0);
});

test('forget and reset drop health state', async t => {
	const {monitor} = harness();
	monitor.setStatus(NAME, 'unhealthy', new Error('down'));
	monitor.setStatus('other', 'connected');
	monitor.forget(NAME);
	t.is(monitor.getStatus(NAME), undefined);
	t.is(monitor.getError(NAME), undefined);
	t.is(monitor.getStatus('other'), 'connected');

	let finish!: () => void;
	void monitor.trackInFlight(
		'other',
		() =>
			new Promise<void>(resolve => {
				finish = resolve;
			}),
	);
	monitor.reset();
	t.is(monitor.getStatus('other'), undefined);
	t.is(monitor.getInFlightCount('other'), 0);
	finish();
});
