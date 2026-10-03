import test from 'ava';
import {TelegramAdapter} from './telegram';
import type {InboundMessage} from './types';

console.log(`\nchannels/telegram.spec.ts`);

interface Call {
	method: string;
	body: Record<string, unknown>;
}

/**
 * Scripted Bot API. `getUpdates` hands out the queued batches one per
 * call, then blocks until the poll is aborted so the loop idles instead of
 * spinning.
 */
function fakeApi(updateBatches: unknown[][], options: {getMeOk?: boolean} = {}) {
	const calls: Call[] = [];
	let failNextPoll = false;
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = url.slice(url.lastIndexOf('/') + 1);
		const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
		calls.push({method, body});

		const json = (payload: unknown, status = 200) =>
			new Response(JSON.stringify(payload), {status});

		switch (method) {
			case 'getMe':
				return options.getMeOk === false
					? json({ok: false, description: 'Unauthorized'}, 401)
					: json({ok: true, result: {id: 999, username: 'nano_bot'}});
			case 'getUpdates': {
				if (failNextPoll) {
					failNextPoll = false;
					throw new TypeError('fetch failed');
				}
				const batch = updateBatches.shift();
				if (batch) return json({ok: true, result: batch});
				return new Promise<Response>((_, reject) => {
					init?.signal?.addEventListener('abort', () =>
						reject(new Error('aborted')),
					);
				});
			}
			default:
				return json({ok: true, result: true});
		}
	}) as typeof fetch;

	return {
		calls,
		fetchImpl,
		failNextPoll: () => {
			failNextPoll = true;
		},
	};
}

function message(overrides: Record<string, unknown> = {}) {
	return {
		message_id: 10,
		text: 'hello',
		from: {id: 42, username: 'aksh'},
		chat: {id: 42, type: 'private'},
		...overrides,
	};
}

async function collect(
	adapter: TelegramAdapter,
	expected: number,
): Promise<InboundMessage[]> {
	const received: InboundMessage[] = [];
	await adapter.start(m => {
		received.push(m);
	});
	const deadline = Date.now() + 2000;
	while (received.length < expected && Date.now() < deadline) {
		await new Promise(r => setTimeout(r, 5));
	}
	return received;
}

test.serial('start resolves the bot identity, then long-polls and advances the offset', async t => {
	const api = fakeApi([
		[{update_id: 100, message: message()}],
		[{update_id: 101, message: message({message_id: 11, text: 'again'})}],
	]);
	const adapter = new TelegramAdapter({token: 'T', fetchImpl: api.fetchImpl});

	const received = await collect(adapter, 2);
	await adapter.stop();

	t.is(api.calls[0]?.method, 'getMe');
	const polls = api.calls.filter(c => c.method === 'getUpdates');
	t.is(polls[0]?.body.offset, 0);
	t.is(polls[1]?.body.offset, 101);
	t.is(polls[2]?.body.offset, 102);
	t.deepEqual(polls[0]?.body.allowed_updates, ['message']);

	t.deepEqual(received[0], {
		platform: 'telegram',
		chatId: '42',
		userId: '42',
		userName: 'aksh',
		text: 'hello',
		messageId: '10',
		isDirect: true,
		mentioned: false,
	});
	t.is(received[1]?.text, 'again');
});

test.serial('group messages detect and strip the @mention, and replies to the bot count as mentions', async t => {
	const api = fakeApi([
		[
			{
				update_id: 1,
				message: message({
					text: 'hey @Nano_Bot fix the build',
					chat: {id: -500, type: 'supergroup'},
				}),
			},
			{
				update_id: 2,
				message: message({
					message_id: 12,
					text: 'and the tests',
					chat: {id: -500, type: 'supergroup'},
					reply_to_message: {from: {id: 999}},
				}),
			},
			{update_id: 3, message: message({text: undefined, sticker: {}})},
			{update_id: 4, message: message({from: {id: 999, username: 'nano_bot'}})},
		],
	]);
	const adapter = new TelegramAdapter({token: 'T', fetchImpl: api.fetchImpl});

	const received = await collect(adapter, 2);
	await adapter.stop();

	t.is(received.length, 2);
	t.is(received[0]?.text, 'hey fix the build');
	t.true(received[0]?.mentioned);
	t.false(received[0]?.isDirect);
	t.is(received[1]?.text, 'and the tests');
	t.true(received[1]?.mentioned);
});

test.serial('reply quotes the message in groups only, and typing sends a chat action', async t => {
	const api = fakeApi([]);
	const adapter = new TelegramAdapter({token: 'T', fetchImpl: api.fetchImpl});
	await adapter.start(() => {});

	const dm: InboundMessage = {
		platform: 'telegram',
		chatId: '42',
		userId: '42',
		text: 'x',
		messageId: '10',
		isDirect: true,
		mentioned: false,
	};
	await adapter.reply(dm, 'done');
	await adapter.reply({...dm, chatId: '-500', isDirect: false}, 'done');
	await adapter.indicateTyping(dm);
	await adapter.stop();

	const sends = api.calls.filter(c => c.method === 'sendMessage');
	t.deepEqual(sends[0]?.body, {chat_id: '42', text: 'done'});
	t.deepEqual(sends[1]?.body, {
		chat_id: '-500',
		text: 'done',
		reply_parameters: {message_id: 10, allow_sending_without_reply: true},
	});
	const typing = api.calls.find(c => c.method === 'sendChatAction');
	t.deepEqual(typing?.body, {chat_id: '42', action: 'typing'});
});

test.serial('a failed poll backs off and polling continues', async t => {
	const api = fakeApi([[{update_id: 7, message: message()}]]);
	api.failNextPoll();
	const sleeps: number[] = [];
	const adapter = new TelegramAdapter({
		token: 'T',
		fetchImpl: api.fetchImpl,
		sleep: async ms => {
			sleeps.push(ms);
		},
	});

	const received = await collect(adapter, 1);
	await adapter.stop();

	t.is(received.length, 1);
	t.deepEqual(sleeps, [1000]);
});

test.serial('start rejects when the token is refused, without echoing the token', async t => {
	const api = fakeApi([], {getMeOk: false});
	const adapter = new TelegramAdapter({token: 'SECRET', fetchImpl: api.fetchImpl});

	const error = await t.throwsAsync(adapter.start(() => {}));

	t.regex(error?.message ?? '', /Telegram getMe failed \(HTTP 401\): Unauthorized/);
	t.false((error?.message ?? '').includes('SECRET'));
});
