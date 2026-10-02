import {createConnection} from 'node:net';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type {Subscription} from '@/events/types';
import {DaemonIpcClient, DaemonIpcServer} from './ipc';

console.log(`\nipc.spec.ts`);

async function makeSocketPath(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'ipc-spec-'));
	return join(dir, 'daemon.sock');
}

const SAMPLE_SUB: Subscription = {
	id: 'sub-1',
	kind: 'file.changed',
	target: {kind: 'agent', name: 'docs'},
	source: 'frontmatter',
	ownerSkill: 'docs',
	filter: {paths: ['docs/**']},
};

test.serial('ping/pong round-trips through the socket', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		t.is(await client.ping(), 'pong');
	} finally {
		await client.disconnect();
		await server.stop();
		await rm(join(path, '..'), {recursive: true, force: true});
	}
});

test.serial('request rejects and releases the pending slot when write throws', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		const internals = client as unknown as {
			socket: {write: (payload: string) => boolean};
			pending: Map<number, unknown>;
		};
		const write = internals.socket.write;
		internals.socket.write = () => {
			throw new Error('serialization failed');
		};

		try {
			await t.throwsAsync(client.ping(), {message: 'serialization failed'});
			t.is(internals.pending.size, 0);
		} finally {
			internals.socket.write = write;
		}
	} finally {
		await client.disconnect();
		await server.stop();
		await rm(join(path, '..'), {recursive: true, force: true});
	}
});

test.serial('a closing socket rejects and drains every pending request', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		const internals = client as unknown as {
			socket: {destroy: () => void};
			pending: Map<number, unknown>;
		};
		const inFlight = client.ping();
		internals.socket.destroy();

		await t.throwsAsync(inFlight, {message: 'IPC connection closed'});
		t.is(internals.pending.size, 0);
	} finally {
		await server.stop();
		await rm(join(path, '..'), {recursive: true, force: true});
	}
});

test.serial('listSubscriptions returns server-side list', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [SAMPLE_SUB],
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		const subs = await client.listSubscriptions();
		t.is(subs.length, 1);
		t.is(subs[0]?.id, 'sub-1');
	} finally {
		await client.disconnect();
		await server.stop();
		await rm(join(path, '..'), {recursive: true, force: true});
	}
});

test.serial('unknown method returns an error response', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {listSubscriptions: () => []});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		// Sneak past the typed client - send a raw bad request
		const err = await t.throwsAsync(async () => {
			await (
				client as unknown as {
					request: (method: string) => Promise<unknown>;
				}
			).request('nonsense' as never);
		});
		t.regex(err?.message ?? '', /unknown method/);
	} finally {
		await client.disconnect();
		await server.stop();
		await rm(join(path, '..'), {recursive: true, force: true});
	}
});

test.serial('invalid JSON returns {id:0, error:"invalid JSON"}', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {listSubscriptions: () => []});
	await server.start();
	try {
		// Talk to the server with a raw socket so we can send garbage that
		// won't parse as JSON. The typed client would never produce this.
		const sock = createConnection(path);
		sock.setEncoding('utf-8');
		const got = await new Promise<string>((resolve, reject) => {
			sock.once('connect', () => sock.write('this is not json\n'));
			sock.once('data', d => resolve(String(d)));
			sock.once('error', reject);
		});
		t.regex(got, /"error":"invalid JSON"/);
		t.regex(got, /"id":0/);
		sock.destroy();
	} finally {
		await server.stop();
		await rm(join(path, '..'), {recursive: true, force: true});
	}
});

test.serial('shutdown method calls server-side handler', async t => {
	const path = await makeSocketPath();
	let shutdownCalls = 0;
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
		shutdown: () => {
			shutdownCalls++;
		},
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		const ack = await client.shutdown();
		t.deepEqual(ack, {accepted: true});
		// Give the deferred shutdown callback a moment to run.
		await new Promise(r => setTimeout(r, 20));
		t.is(shutdownCalls, 1);
	} finally {
		await client.disconnect();
		await server.stop();
		await rm(join(path, '..'), {recursive: true, force: true});
	}
});

test.serial(
	'shutdown method returns error when server has no handler',
	async t => {
		const path = await makeSocketPath();
		const server = new DaemonIpcServer(path, {
			listSubscriptions: () => [],
			// no shutdown handler
		});
		await server.start();
		const client = new DaemonIpcClient(path);
		await client.connect();
		try {
			const err = await t.throwsAsync(() => client.shutdown());
			t.regex(err?.message ?? '', /shutdown method not enabled/);
		} finally {
			await client.disconnect();
			await server.stop();
			await rm(join(path, '..'), {recursive: true, force: true});
		}
	},
);

test.serial(
	'client disconnects mid-stream - server stays alive and accepts new connections',
	async t => {
		const path = await makeSocketPath();
		const server = new DaemonIpcServer(path, {
			listSubscriptions: () => [SAMPLE_SUB],
		});
		await server.start();
		try {
			// First client sends a partial request, then closes the socket
			// without giving the server a chance to respond.
			await new Promise<void>(resolve => {
				const sock = createConnection(path);
				sock.once('connect', () => {
					sock.write('{"id":5,"method":"pi');
					sock.destroy();
					resolve();
				});
			});

			// Give the server a tick to observe the close event.
			await new Promise(r => setTimeout(r, 50));

			// Second client should be able to connect and round-trip normally.
			const client = new DaemonIpcClient(path);
			await client.connect();
			try {
				t.is(await client.ping(), 'pong');
				const subs = await client.listSubscriptions();
				t.is(subs.length, 1);
			} finally {
				await client.disconnect();
			}
		} finally {
			await server.stop();
			await rm(join(path, '..'), {recursive: true, force: true});
		}
	},
);

test.serial('prompt runs through the handler and returns its result', async t => {
	const path = await makeSocketPath();
	const seen: unknown[] = [];
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
		prompt: async request => {
			seen.push(request);
			return {success: true, output: `echo: ${request.prompt}`, durationMs: 3};
		},
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		const result = await client.prompt({
			prompt: 'fix the build',
			mode: 'plan',
			source: 'telegram:7',
		});
		t.deepEqual(result, {success: true, output: 'echo: fix the build', durationMs: 3});
		t.deepEqual(seen, [{prompt: 'fix the build', mode: 'plan', source: 'telegram:7'}]);
	} finally {
		await client.disconnect();
		await server.stop();
		await rm(join(path, '..'), {recursive: true, force: true});
	}
});

test.serial('prompt rejects bad params before the handler sees them, and reports a missing handler', async t => {
	const path = await makeSocketPath();
	let handlerCalls = 0;
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
		prompt: async () => {
			handlerCalls++;
			return {success: true, output: '', durationMs: 0};
		},
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		await t.throwsAsync(client.prompt({prompt: '   '}), {
			message: 'prompt must be a non-empty string',
		});
		await t.throwsAsync(
			client.prompt({prompt: 'x', mode: 'yolo' as unknown as 'plan'}),
			{message: 'mode must be one of: headless, plan'},
		);
		t.is(handlerCalls, 0);
	} finally {
		await client.disconnect();
		await server.stop();
	}

	const bare = new DaemonIpcServer(path, {listSubscriptions: () => []});
	await bare.start();
	const client2 = new DaemonIpcClient(path);
	await client2.connect();
	try {
		await t.throwsAsync(client2.prompt({prompt: 'x'}), {
			message: 'prompt method not enabled on this daemon',
		});
	} finally {
		await client2.disconnect();
		await bare.stop();
		await rm(join(path, '..'), {recursive: true, force: true});
	}
});

test.serial('a ping sent during a long prompt is answered before the prompt completes', async t => {
	const path = await makeSocketPath();
	let release!: () => void;
	const gate = new Promise<void>(resolve => {
		release = resolve;
	});
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
		prompt: async () => {
			await gate;
			return {success: true, output: 'late', durationMs: 1};
		},
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		const slow = client.prompt({prompt: 'slow'});
		t.is(await client.ping(), 'pong');
		release();
		t.is((await slow).output, 'late');
	} finally {
		await client.disconnect();
		await server.stop();
		await rm(join(path, '..'), {recursive: true, force: true});
	}
});

test.serial('a handler that throws surfaces as an IPC error', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
		prompt: async () => {
			throw new Error('executor exploded');
		},
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		await t.throwsAsync(client.prompt({prompt: 'x'}), {message: 'executor exploded'});
	} finally {
		await client.disconnect();
		await server.stop();
		await rm(join(path, '..'), {recursive: true, force: true});
	}
});
