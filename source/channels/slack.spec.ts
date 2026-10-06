import {EventEmitter} from 'node:events';
import test from 'ava';
import {SlackAdapter} from './slack';
import type {SocketLike} from './socket';
import type {InboundMessage} from './types';

console.log(`\nchannels/slack.spec.ts`);

class FakeSocket extends EventEmitter implements SocketLike {
	sent: string[] = [];
	closed: Array<{code?: number; reason?: string}> = [];

	constructor(readonly url: string) {
		super();
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(code?: number, reason?: string): void {
		this.closed.push({code, reason});
		queueMicrotask(() => this.emit('close', code ?? 1005));
	}

	/** Push a frame from the "server". */
	receive(frame: unknown): void {
		this.emit('message', Buffer.from(JSON.stringify(frame)));
	}
}

interface Call {
	method: string;
	token: string;
	body: Record<string, unknown>;
}

function fakeApi(options: {authOk?: boolean} = {}) {
	const calls: Call[] = [];
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = url.slice(url.lastIndexOf('/') + 1);
		const headers = init?.headers as Record<string, string>;
		calls.push({
			method,
			token: headers.authorization.replace('Bearer ', ''),
			body: init?.body ? JSON.parse(String(init.body)) : {},
		});
		const json = (payload: unknown) => new Response(JSON.stringify(payload));
		switch (method) {
			case 'auth.test':
				return options.authOk === false
					? json({ok: false, error: 'invalid_auth'})
					: json({ok: true, user_id: 'UBOT'});
			case 'apps.connections.open':
				return json({ok: true, url: `wss://wss.slack.test/${calls.length}`});
			default:
				return json({ok: true});
		}
	}) as typeof fetch;
	return {calls, fetchImpl};
}

function harness(options: {authOk?: boolean} = {}) {
	const api = fakeApi(options);
	const sockets: FakeSocket[] = [];
	const received: InboundMessage[] = [];
	const adapter = new SlackAdapter({
		botToken: 'xoxb',
		appToken: 'xapp',
		fetchImpl: api.fetchImpl,
		createSocket: url => {
			const socket = new FakeSocket(url);
			sockets.push(socket);
			return socket;
		},
		reconnectDelayMs: 1,
	});
	return {api, sockets, received, adapter};
}

function envelope(event: Record<string, unknown>, id = 'env-1') {
	return {type: 'events_api', envelope_id: id, payload: {event}};
}

const settle = () => new Promise(r => setTimeout(r, 5));

test.serial('start validates the bot token, opens a socket, and acks every envelope', async t => {
	const {api, sockets, received, adapter} = harness();
	await adapter.start(m => {
		received.push(m);
	});

	t.is(api.calls[0]?.method, 'auth.test');
	t.is(api.calls[0]?.token, 'xoxb');
	t.is(api.calls[1]?.method, 'apps.connections.open');
	t.is(api.calls[1]?.token, 'xapp');
	t.is(sockets.length, 1);

	const socket = sockets[0] as FakeSocket;
	socket.receive({type: 'hello'});
	socket.receive(
		envelope({
			type: 'message',
			channel_type: 'im',
			channel: 'D1',
			user: 'U1',
			text: 'hi there',
			ts: '1.0',
		}),
	);
	await settle();

	t.deepEqual(socket.sent, [JSON.stringify({envelope_id: 'env-1'})]);
	t.deepEqual(received, [
		{
			platform: 'slack',
			chatId: 'D1',
			userId: 'U1',
			text: 'hi there',
			messageId: '1.0',
			threadId: undefined,
			isDirect: true,
			mentioned: false,
		},
	]);
	await adapter.stop();
});

test.serial('channel mentions are stripped and de-duplicated across message and app_mention', async t => {
	const {sockets, received, adapter} = harness();
	await adapter.start(m => {
		received.push(m);
	});
	const socket = sockets[0] as FakeSocket;

	const base = {
		channel: 'C1',
		channel_type: 'channel',
		user: 'U1',
		text: '<@UBOT> run the tests',
		ts: '2.0',
		thread_ts: '1.5',
	};
	socket.receive(envelope({type: 'app_mention', ...base}, 'a'));
	socket.receive(envelope({type: 'message', ...base}, 'b'));
	socket.receive(envelope({type: 'message', ...base, ts: '3.0', bot_id: 'B9'}, 'c'));
	socket.receive(envelope({type: 'message', ...base, ts: '4.0', subtype: 'message_changed'}, 'd'));
	socket.receive(envelope({type: 'message', ...base, ts: '5.0', user: 'UBOT'}, 'e'));
	await settle();

	t.is(received.length, 1);
	t.is(received[0]?.text, 'run the tests');
	t.true(received[0]?.mentioned);
	t.false(received[0]?.isDirect);
	t.is(received[0]?.threadId, '1.5');
	t.is(socket.sent.length, 5, 'every envelope is acked even when ignored');
	await adapter.stop();
});

test.serial('replies thread in channels, stay flat in DMs, and typing adds a reaction', async t => {
	const {api, adapter} = harness();
	await adapter.start(() => {});

	const dm: InboundMessage = {
		platform: 'slack',
		chatId: 'D1',
		userId: 'U1',
		text: 'x',
		messageId: '1.0',
		isDirect: true,
		mentioned: false,
	};
	await adapter.reply(dm, 'flat');
	await adapter.reply({...dm, chatId: 'C1', isDirect: false}, 'threaded');
	await adapter.reply({...dm, chatId: 'C1', isDirect: false, threadId: '0.5'}, 'in thread');
	await adapter.indicateTyping(dm);
	await adapter.stop();

	const posts = api.calls.filter(c => c.method === 'chat.postMessage').map(c => c.body);
	t.deepEqual(posts, [
		{channel: 'D1', text: 'flat'},
		{channel: 'C1', text: 'threaded', thread_ts: '1.0'},
		{channel: 'C1', text: 'in thread', thread_ts: '0.5'},
	]);
	const reaction = api.calls.find(c => c.method === 'reactions.add');
	t.deepEqual(reaction?.body, {channel: 'D1', name: 'eyes', timestamp: '1.0'});
});

test.serial('a disconnect frame reconnects on a fresh socket; stop does not', async t => {
	const {sockets, adapter} = harness();
	await adapter.start(() => {});
	const first = sockets[0] as FakeSocket;

	first.receive({type: 'disconnect', reason: 'refresh_requested'});
	await settle();
	await settle();

	t.is(first.closed.length, 1);
	t.is(sockets.length, 2);
	t.not(sockets[1]?.url, first.url);

	await adapter.stop();
	await settle();
	t.is(sockets.length, 2);
	t.is(sockets[1]?.closed[0]?.code, 1000);
});

test.serial('start rejects when the bot token is invalid', async t => {
	const {sockets, adapter} = harness({authOk: false});

	await t.throwsAsync(adapter.start(() => {}), {
		message: /Slack auth\.test failed \(HTTP 200\): invalid_auth/,
	});
	t.is(sockets.length, 0);
});
