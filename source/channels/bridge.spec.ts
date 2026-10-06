import test from 'ava';
import type {PromptRequest, PromptResult} from '@/daemon/prompt-runner';
import type {ChannelsConfig} from '@/types/config';
import {buildPrompt, ChannelBridge} from './bridge';
import type {ChannelAdapter, InboundHandler, InboundMessage} from './types';

console.log(`\nchannels/bridge.spec.ts`);

class FakeAdapter implements ChannelAdapter {
	readonly platform = 'telegram' as const;
	maxMessageLength = 4096;
	handler: InboundHandler | null = null;
	replies: Array<{to: InboundMessage; text: string}> = [];
	typing = 0;
	started = 0;
	stopped = 0;
	failStart = false;

	async start(onMessage: InboundHandler): Promise<void> {
		if (this.failStart) throw new Error('401 unauthorized');
		this.started++;
		this.handler = onMessage;
	}

	async stop(): Promise<void> {
		this.stopped++;
	}

	async reply(to: InboundMessage, text: string): Promise<void> {
		this.replies.push({to, text});
	}

	async indicateTyping(): Promise<void> {
		this.typing++;
	}

	/** Deliver a message as the platform would and wait for the bridge to finish with it. */
	async deliver(message: Partial<InboundMessage> = {}): Promise<void> {
		await this.handler?.({
			platform: 'telegram',
			chatId: 'chat-1',
			userId: 'u-allowed',
			text: 'summarize the logs',
			messageId: 'm-1',
			isDirect: true,
			mentioned: false,
			...message,
		});
	}
}

function okResult(output: string): PromptResult {
	return {success: true, output, durationMs: 5};
}

const CONFIG: ChannelsConfig = {
	telegram: {token: 't', allowedUsers: ['u-allowed'], allowedChats: ['chat-open']},
};

function setup(
	invoke: (request: PromptRequest) => Promise<PromptResult>,
	config: ChannelsConfig = CONFIG,
) {
	const adapter = new FakeAdapter();
	const bridge = new ChannelBridge({
		adapters: [adapter],
		invoke,
		config,
		projectLabel: '/repo',
	});
	return {adapter, bridge};
}

test('messages from users outside allowedUsers are dropped without a reply', async t => {
	const requests: PromptRequest[] = [];
	const {adapter, bridge} = setup(async request => {
		requests.push(request);
		return okResult('x');
	});
	await bridge.start();

	await adapter.deliver({userId: 'u-stranger'});

	t.deepEqual(requests, []);
	t.deepEqual(adapter.replies, []);
});

test('outside a DM the bot only answers when mentioned or in an open chat', async t => {
	const requests: PromptRequest[] = [];
	const {adapter, bridge} = setup(async request => {
		requests.push(request);
		return okResult('ok');
	});
	await bridge.start();

	await adapter.deliver({isDirect: false, chatId: 'chat-group'});
	t.is(requests.length, 0);

	await adapter.deliver({isDirect: false, chatId: 'chat-group', mentioned: true});
	t.is(requests.length, 1);

	await adapter.deliver({isDirect: false, chatId: 'chat-open'});
	t.is(requests.length, 2);
});

test('an accepted message becomes a prompt run tagged with its platform and sender', async t => {
	const requests: PromptRequest[] = [];
	const {adapter, bridge} = setup(async request => {
		requests.push(request);
		return okResult('Logs look clean.');
	});
	await bridge.start();

	await adapter.deliver();

	t.deepEqual(requests, [
		{prompt: 'summarize the logs', mode: 'headless', source: 'telegram:u-allowed'},
	]);
	t.is(adapter.typing, 1);
	t.is(adapter.replies.length, 1);
	t.is(adapter.replies[0]?.text, 'Logs look clean.');
	t.is(adapter.replies[0]?.to.messageId, 'm-1');
});

test('the channel mode is forwarded to the daemon', async t => {
	const requests: PromptRequest[] = [];
	const {adapter, bridge} = setup(
		async request => {
			requests.push(request);
			return okResult('would do X');
		},
		{telegram: {token: 't', allowedUsers: ['u-allowed'], mode: 'plan'}},
	);
	await bridge.start();

	await adapter.deliver();

	t.is(requests[0]?.mode, 'plan');
});

test('earlier exchanges in the same chat are carried into the next prompt, bounded by historyTurns', async t => {
	const prompts: string[] = [];
	let n = 0;
	const {adapter, bridge} = setup(
		async request => {
			prompts.push(request.prompt);
			n++;
			return okResult(`answer ${n}`);
		},
		{telegram: {token: 't', allowedUsers: ['u-allowed']}, historyTurns: 1},
	);
	await bridge.start();

	await adapter.deliver({text: 'first'});
	await adapter.deliver({text: 'second'});
	await adapter.deliver({text: 'third'});
	await adapter.deliver({text: 'other chat', chatId: 'chat-2'});

	t.is(prompts[0], 'first');
	t.is(prompts[1], buildPrompt([{user: 'first', assistant: 'answer 1'}], 'second'));
	// historyTurns: 1 keeps only the most recent exchange.
	t.is(prompts[2], buildPrompt([{user: 'second', assistant: 'answer 2'}], 'third'));
	// History is per chat.
	t.is(prompts[3], 'other chat');
});

test('/reset forgets the chat and /help describes the bridge without running anything', async t => {
	const prompts: string[] = [];
	const {adapter, bridge} = setup(async request => {
		prompts.push(request.prompt);
		return okResult('a');
	});
	await bridge.start();

	await adapter.deliver({text: 'remember this'});
	await adapter.deliver({text: '/reset'});
	await adapter.deliver({text: '/help@MyBot'});
	await adapter.deliver({text: 'fresh'});

	t.deepEqual(prompts, ['remember this', 'fresh']);
	t.regex(adapter.replies[1]?.text ?? '', /Forgot/);
	t.regex(adapter.replies[2]?.text ?? '', /\/repo/);
	t.regex(adapter.replies[2]?.text ?? '', /\/reset/);
});

test('a second message to a busy chat gets a busy reply and no second run', async t => {
	let release!: () => void;
	const gate = new Promise<void>(resolve => {
		release = resolve;
	});
	let runs = 0;
	const {adapter, bridge} = setup(async () => {
		runs++;
		await gate;
		return okResult('finished');
	});
	await bridge.start();

	const first = adapter.deliver({text: 'slow task'});
	await new Promise(r => setTimeout(r, 5));
	await adapter.deliver({text: 'are you there?'});

	t.is(runs, 1);
	t.regex(adapter.replies[0]?.text ?? '', /Still working/);

	release();
	await first;
	t.is(adapter.replies[1]?.text, 'finished');

	// The slot is released once the run ends.
	await adapter.deliver({text: 'again'});
	t.is(runs, 2);
});

test('a failed run and an unreachable daemon are reported to the sender', async t => {
	let mode: 'fail' | 'throw' = 'fail';
	const {adapter, bridge} = setup(async () => {
		if (mode === 'throw') throw new Error('ECONNREFUSED');
		return {success: false, output: '', error: 'model refused', durationMs: 1};
	});
	await bridge.start();

	await adapter.deliver();
	t.is(adapter.replies[0]?.text, 'The run failed: model refused');

	mode = 'throw';
	await adapter.deliver();
	t.regex(adapter.replies[1]?.text ?? '', /Could not reach the daemon: .*ECONNREFUSED/);
});

test('a run that outlives timeoutMs is reported as a timeout', async t => {
	const {adapter, bridge} = setup(
		() => new Promise(() => {}),
		{telegram: {token: 't', allowedUsers: ['u-allowed']}, timeoutMs: 20},
	);
	await bridge.start();

	await adapter.deliver();

	t.regex(adapter.replies[0]?.text ?? '', /No answer from the daemon after 1 minute/);
	t.regex(adapter.replies[0]?.text ?? '', /nanocoder daemon logs/);
});

test('long replies are split to the adapter limit, and an empty reply still says something', async t => {
	let output = Array.from({length: 40}, (_, i) => `line ${i}`).join('\n');
	const {adapter, bridge} = setup(async () => okResult(output));
	adapter.maxMessageLength = 60;
	await bridge.start();

	await adapter.deliver();
	t.true(adapter.replies.length > 1);
	for (const reply of adapter.replies) t.true(reply.text.length <= 60);
	t.is(adapter.replies.map(r => r.text).join('\n'), output);

	adapter.replies = [];
	output = '   ';
	await adapter.deliver();
	t.regex(adapter.replies[0]?.text ?? '', /finished without a written summary/);
});

test('start stops the adapters already up when a later one fails', async t => {
	const good = new FakeAdapter();
	const bad = new FakeAdapter();
	bad.failStart = true;
	const bridge = new ChannelBridge({
		adapters: [good, bad],
		invoke: async () => okResult(''),
		config: CONFIG,
	});

	await t.throwsAsync(bridge.start(), {message: /telegram failed to start: .*401/});

	t.is(good.started, 1);
	t.is(good.stopped, 1);
	t.is(bad.stopped, 0);
});

test('stop winds adapters down in reverse order', async t => {
	const order: string[] = [];
	const make = (name: string) => {
		const adapter = new FakeAdapter();
		adapter.stop = async () => {
			order.push(name);
		};
		return adapter;
	};
	const bridge = new ChannelBridge({
		adapters: [make('a'), make('b')],
		invoke: async () => okResult(''),
		config: CONFIG,
	});
	await bridge.start();
	await bridge.stop();

	t.deepEqual(order, ['b', 'a']);
});
