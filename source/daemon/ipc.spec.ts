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
