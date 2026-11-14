import {createConnection} from 'node:net';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type {Subscription} from '@/events/types';
import {DaemonIpcClient, DaemonIpcServer} from './ipc';
import {resolveSocketPath} from './lockfile';

console.log(`\nipc.spec.ts`);

test.serial('malformed requests leave the socket usable for a valid ping', async t => {
	const {path, dir} = await makeSocketPath();
	const server = new DaemonIpcServer(path, {listSubscriptions: () => []});
	await server.start();
	const socket = createConnection(path);
	socket.setEncoding('utf-8');
	t.teardown(async () => {
		socket.destroy();
		await server.stop();
		await rm(dir, {recursive: true, force: true});
	});
	const invalid = [null, 42, 'ping', true, [], {}, {id: '1', method: 'ping'}, {id: 1, method: null}].map(value => JSON.stringify(value));
	invalid.push('{"id":1e309,"method":"ping"}');
	const responses = await new Promise<Array<{id: number; result?: string; error?: string}>>((resolve, reject) => {
		let buffer = '';
		const received: Array<{id: number; result?: string; error?: string}> = [];
		socket.once('error', reject);
		socket.on('data', chunk => {
			buffer += chunk;
			let nl: number;
			while ((nl = buffer.indexOf('\n')) !== -1) {
				received.push(JSON.parse(buffer.slice(0, nl)));
				buffer = buffer.slice(nl + 1);
			}
			if (received.length === invalid.length + 1) resolve(received);
		});
		socket.once('connect', () => {
			socket.write([...invalid, JSON.stringify({id: 7, method: 'ping'})].join('\n') + '\n');
		});
	});
	t.deepEqual(responses.slice(0, -1), invalid.map(() => ({id: 0, error: 'invalid request'})));
	t.deepEqual(responses.at(-1), {id: 7, result: 'pong'});
});

async function makeSocketPath(): Promise<{path: string; dir: string}> {
	const dir = await mkdtemp(join(tmpdir(), 'ipc-spec-'));
	await mkdir(join(dir, '.nanocoder'));
	const path = resolveSocketPath(dir, process.platform, tmpdir());
	return {path, dir};
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
	const {path, dir} = await makeSocketPath();
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
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial('request rejects and releases the pending slot when write throws', async t => {
	const {path, dir} = await makeSocketPath();
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
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial('a closing socket rejects and drains every pending request', async t => {
	const {path, dir} = await makeSocketPath();
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
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial('listSubscriptions returns server-side list', async t => {
	const {path, dir} = await makeSocketPath();
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
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial('unknown method returns an error response', async t => {
	const {path, dir} = await makeSocketPath();
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
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial('invalid JSON returns {id:0, error:"invalid JSON"}', async t => {
	const {path, dir} = await makeSocketPath();
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
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial('shutdown method calls server-side handler', async t => {
	const {path, dir} = await makeSocketPath();
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
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial(
	'shutdown method returns error when server has no handler',
	async t => {
		const {path, dir} = await makeSocketPath();
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
			await rm(dir, {recursive: true, force: true});
		}
	},
);

test.serial(
	'client disconnects mid-stream - server stays alive and accepts new connections',
	async t => {
		const {path, dir} = await makeSocketPath();
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
			await rm(dir, {recursive: true, force: true});
		}
	},
);
