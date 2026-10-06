import {EventEmitter} from 'node:events';
import test from 'ava';
import {DiscordAdapter} from './discord';
import type {SocketLike} from './socket';
import type {ChannelLogger, InboundMessage} from './types';

console.log(`\nchannels/discord.spec.ts`);

class FakeSocket extends EventEmitter implements SocketLike {
	sent: Array<{op: number; d: unknown}> = [];
	closed: Array<{code?: number; reason?: string}> = [];

	constructor(readonly url: string) {
		super();
	}

	send(data: string): void {
		this.sent.push(JSON.parse(data));
	}

	close(code?: number, reason?: string): void {
		this.closed.push({code, reason});
		queueMicrotask(() => this.emit('close', code ?? 1005));
	}

	receive(frame: unknown): void {
		this.emit('message', JSON.stringify(frame));
	}
}

interface Call {
	method: string;
	path: string;
	auth: string;
	body: Record<string, unknown> | undefined;
}

function fakeApi(options: {gatewayStatus?: number} = {}) {
	const calls: Call[] = [];
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const path = url.replace(/^https:\/\/discord\.com\/api\/v10/, '');
		const headers = init?.headers as Record<string, string>;
		calls.push({
			method: init?.method ?? 'GET',
			path,
			auth: headers.authorization,
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		});
		if (path === '/gateway/bot') {
			return options.gatewayStatus === 401
				? new Response(JSON.stringify({message: '401: Unauthorized'}), {status: 401})
				: new Response(JSON.stringify({url: 'wss://gateway.discord.test'}));
		}
		if (path.endsWith('/typing')) return new Response(null, {status: 204});
		return new Response(JSON.stringify({id: 'sent'}));
	}) as typeof fetch;
	return {calls, fetchImpl};
}

function harness(options: {gatewayStatus?: number} = {}) {
	const api = fakeApi(options);
	const sockets: FakeSocket[] = [];
	const received: InboundMessage[] = [];
	const logs: string[] = [];
	const logger: ChannelLogger = {
		info: m => logs.push(`info ${m}`),
		warn: m => logs.push(`warn ${m}`),
		error: m => logs.push(`error ${m}`),
	};
	const adapter = new DiscordAdapter({
		token: 'BOT-TOKEN',
		fetchImpl: api.fetchImpl,
		createSocket: url => {
			const socket = new FakeSocket(url);
			sockets.push(socket);
			return socket;
		},
		reconnectDelayMs: 1,
		logger,
	});
	return {api, sockets, received, logs, adapter};
}

const settle = () => new Promise(r => setTimeout(r, 5));

function ready(socket: FakeSocket, interval = 10_000): void {
	socket.receive({op: 10, d: {heartbeat_interval: interval}});
	socket.receive({
		op: 0,
		s: 1,
		t: 'READY',
		d: {session_id: 'sess-1', resume_gateway_url: 'wss://resume.discord.test', user: {id: 'BOT'}},
	});
}

function messageCreate(overrides: Record<string, unknown> = {}) {
	return {
		op: 0,
		s: 2,
		t: 'MESSAGE_CREATE',
		d: {
			id: 'm1',
			channel_id: 'ch1',
			content: 'hello',
			author: {id: 'user1', username: 'aksh'},
			...overrides,
		},
	};
}

test.serial('start fetches the gateway with the bot token, identifies on HELLO, and delivers messages', async t => {
	const {api, sockets, received, adapter} = harness();
	await adapter.start(m => {
		received.push(m);
	});

	t.deepEqual(api.calls[0], {method: 'GET', path: '/gateway/bot', auth: 'Bot BOT-TOKEN', body: undefined});
	t.is(sockets[0]?.url, 'wss://gateway.discord.test/?v=10&encoding=json');

	const socket = sockets[0] as FakeSocket;
	ready(socket);
	const identify = socket.sent[0];
	t.is(identify?.op, 2);
	const d = identify?.d as {token: string; intents: number};
	t.is(d.token, 'BOT-TOKEN');
	t.is(d.intents & (1 << 15), 1 << 15, 'MESSAGE_CONTENT intent requested');

	socket.receive(messageCreate());
	socket.receive(messageCreate({id: 'm2', author: {id: 'other', bot: true}}));
	socket.receive(messageCreate({id: 'm3', author: {id: 'BOT'}}));
	socket.receive(
		messageCreate({
			id: 'm4',
			guild_id: 'g1',
			content: '<@!BOT> run the tests',
			mentions: [{id: 'BOT'}],
		}),
	);
	await settle();

	t.is(received.length, 2);
	t.deepEqual(received[0], {
		platform: 'discord',
		chatId: 'ch1',
		userId: 'user1',
		userName: 'aksh',
		text: 'hello',
		messageId: 'm1',
		isDirect: true,
		mentioned: false,
	});
	t.is(received[1]?.text, 'run the tests');
	t.true(received[1]?.mentioned);
	t.false(received[1]?.isDirect);
	await adapter.stop();
});

test.serial('heartbeats carry the last sequence, and a missed ack reconnects with RESUME', async t => {
	const {sockets, adapter} = harness();
	await adapter.start(() => {});
	const first = sockets[0] as FakeSocket;
	ready(first, 15);
	first.receive(messageCreate({id: 'm1'}));

	await new Promise(r => setTimeout(r, 25));
	const beat = first.sent.find(f => f.op === 1);
	t.deepEqual(beat, {op: 1, d: 2});

	// No ack arrives: the next tick must treat the socket as dead.
	await new Promise(r => setTimeout(r, 30));
	t.is(first.closed[0]?.code, 4000);
	t.is(sockets.length, 2);
	const second = sockets[1] as FakeSocket;
	t.is(second.url, 'wss://resume.discord.test/?v=10&encoding=json');

	second.receive({op: 10, d: {heartbeat_interval: 10_000}});
	t.deepEqual(second.sent[0], {
		op: 6,
		d: {token: 'BOT-TOKEN', session_id: 'sess-1', seq: 2},
	});
	await adapter.stop();
});

test.serial('op 11 keeps the connection alive and op 9 (non-resumable) identifies afresh', async t => {
	const {sockets, adapter} = harness();
	await adapter.start(() => {});
	const first = sockets[0] as FakeSocket;
	ready(first, 15);
	await new Promise(r => setTimeout(r, 20));
	first.receive({op: 11});
	await new Promise(r => setTimeout(r, 20));
	t.is(first.closed.length, 0, 'an acked heartbeat does not close the socket');

	first.receive({op: 9, d: false});
	await settle();
	await settle();
	t.is(sockets.length, 2);
	const second = sockets[1] as FakeSocket;
	t.is(second.url, 'wss://gateway.discord.test/?v=10&encoding=json');
	second.receive({op: 10, d: {heartbeat_interval: 10_000}});
	t.is(second.sent[0]?.op, 2, 'session forgotten, so IDENTIFY not RESUME');
	await adapter.stop();
});

test.serial('fatal close codes are explained and not retried', async t => {
	const {sockets, logs, adapter} = harness();
	await adapter.start(() => {});
	const socket = sockets[0] as FakeSocket;

	socket.emit('close', 4014);
	await settle();
	await settle();

	t.is(sockets.length, 1);
	t.true(logs.some(l => l.startsWith('error') && /Message Content Intent/.test(l)));
	await adapter.stop();
});

test.serial('reply references the message in guilds only and never pings anyone', async t => {
	const {api, adapter} = harness();
	await adapter.start(() => {});

	const dm: InboundMessage = {
		platform: 'discord',
		chatId: 'ch1',
		userId: 'user1',
		text: 'x',
		messageId: 'm1',
		isDirect: true,
		mentioned: false,
	};
	await adapter.reply(dm, 'flat');
	await adapter.reply({...dm, isDirect: false}, 'quoted');
	await adapter.indicateTyping(dm);
	await adapter.stop();

	const posts = api.calls.filter(c => c.path === '/channels/ch1/messages');
	t.deepEqual(posts[0]?.body, {content: 'flat', allowed_mentions: {parse: []}});
	t.deepEqual(posts[1]?.body, {
		content: 'quoted',
		allowed_mentions: {parse: []},
		message_reference: {message_id: 'm1', fail_if_not_exists: false},
	});
	t.truthy(api.calls.find(c => c.path === '/channels/ch1/typing'));
});

test.serial('start rejects with the API error when the token is refused', async t => {
	const {sockets, adapter} = harness({gatewayStatus: 401});

	await t.throwsAsync(adapter.start(() => {}), {
		message: /Discord GET \/gateway\/bot failed \(HTTP 401\): 401: Unauthorized/,
	});
	t.is(sockets.length, 0);
});
