import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type {Subscription} from '@/events/types';
import type {TriggeredRunActivity} from '@/skills/dispatcher';
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

function sampleActivity(): TriggeredRunActivity {
	return {
		subscription: SAMPLE_SUB,
		event: {
			kind: 'file.changed',
			payload: {file: 'docs/intro.md', eventKind: 'change'},
			at: 0,
		},
		mode: 'headless',
		result: {
			subagentName: 'docs',
			output: 'done',
			success: true,
			executionTimeMs: 0,
		},
		durationMs: 0,
	};
}

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

test.serial('subscribeActivity streams broadcasts to the client', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();

	const received: TriggeredRunActivity[] = [];
	try {
		await client.subscribeActivity(a => received.push(a));
		server.broadcastActivity(sampleActivity());

		// Wait briefly for the broadcast to make it through the socket
		await new Promise(r => setTimeout(r, 50));
		t.is(received.length, 1);
		t.is(received[0]?.subscription.id, 'sub-1');
	} finally {
		await client.disconnect();
		await server.stop();
		await rm(join(path, '..'), {recursive: true, force: true});
	}
});

test.serial('multiple subscribed clients all receive broadcasts', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
	});
	await server.start();
	const clients = [new DaemonIpcClient(path), new DaemonIpcClient(path)];
	const events: TriggeredRunActivity[][] = [[], []];
	try {
		await clients[0]!.connect();
		await clients[1]!.connect();
		await clients[0]!.subscribeActivity(a => events[0]!.push(a));
		await clients[1]!.subscribeActivity(a => events[1]!.push(a));
		server.broadcastActivity(sampleActivity());
		await new Promise(r => setTimeout(r, 50));
		t.is(events[0]!.length, 1);
		t.is(events[1]!.length, 1);
	} finally {
		for (const c of clients) await c.disconnect();
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
			await (client as unknown as {
				request: (method: string) => Promise<unknown>;
			}).request('nonsense' as never);
		});
		t.regex(err?.message ?? '', /unknown method/);
	} finally {
		await client.disconnect();
		await server.stop();
		await rm(join(path, '..'), {recursive: true, force: true});
	}
});
