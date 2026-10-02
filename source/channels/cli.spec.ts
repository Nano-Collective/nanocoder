import test from 'ava';
import type {DaemonLock} from '@/daemon/lockfile';
import type {PromptRequest} from '@/daemon/prompt-runner';
import type {ChannelsConfig} from '@/types/config';
import {type ChannelsCliDeps, runChannelsCli} from './cli';
import type {ChannelAdapter, InboundHandler, InboundMessage} from './types';

console.log(`\nchannels/cli.spec.ts`);

class StubAdapter implements ChannelAdapter {
	readonly platform = 'telegram' as const;
	readonly maxMessageLength = 4096;
	handler: InboundHandler | null = null;
	replies: string[] = [];
	stopped = 0;

	async start(onMessage: InboundHandler): Promise<void> {
		this.handler = onMessage;
	}

	async stop(): Promise<void> {
		this.stopped++;
	}

	async reply(_to: InboundMessage, text: string): Promise<void> {
		this.replies.push(text);
	}
}

const LOCK: DaemonLock = {
	pid: 4242,
	socketPath: '/tmp/daemon.sock',
	startedAt: 0,
	projectRoot: '/repo',
};

const CONFIG: ChannelsConfig = {
	telegram: {token: 't', allowedUsers: ['7']},
	discord: {token: 'd', allowedUsers: ['8', '9'], allowedChats: ['c1'], mode: 'plan'},
};

function deps(overrides: Partial<ChannelsCliDeps> = {}): Partial<ChannelsCliDeps> {
	return {
		loadConfig: () => CONFIG,
		configWarnings: () => [],
		readLiveLockfile: async () => LOCK,
		createAdapters: () => [],
		invoke: async () => ({success: true, output: '', durationMs: 0}),
		waitForStop: async () => {},
		logger: {info: () => {}, warn: () => {}, error: () => {}},
		...overrides,
	};
}

test('start refuses without any configured channel', async t => {
	const result = await runChannelsCli('start', {
		projectRoot: '/repo',
		deps: deps({loadConfig: () => undefined}),
	});

	t.is(result.exitCode, 1);
	t.regex(result.output, /No chat channels are configured/);
});

test('start refuses when the daemon is not running', async t => {
	const result = await runChannelsCli('start', {
		projectRoot: '/repo',
		deps: deps({readLiveLockfile: async () => null}),
	});

	t.is(result.exitCode, 1);
	t.regex(result.output, /daemon is not running for \/repo/);
	t.regex(result.output, /nanocoder daemon start/);
});

test('start bridges adapters to the daemon for the project, then stops them on shutdown', async t => {
	const adapter = new StubAdapter();
	const invoked: Array<{projectRoot: string; request: PromptRequest}> = [];
	const logs: string[] = [];
	let release!: () => void;
	const stopSignal = new Promise<void>(resolve => {
		release = resolve;
	});

	const run = runChannelsCli('start', {
		projectRoot: '/repo',
		deps: deps({
			createAdapters: () => [adapter],
			invoke: async (projectRoot, request) => {
				invoked.push({projectRoot, request});
				return {success: true, output: 'all green', durationMs: 1};
			},
			waitForStop: () => stopSignal,
			logger: {info: m => logs.push(m), warn: () => {}, error: () => {}},
		}),
	});

	// Wait for the bridge to come up, then drive a message through it.
	while (!adapter.handler) await new Promise(r => setTimeout(r, 1));
	await adapter.handler({
		platform: 'telegram',
		chatId: 'c',
		userId: '7',
		text: 'is CI green?',
		isDirect: true,
		mentioned: false,
	});

	t.is(invoked[0]?.projectRoot, '/repo');
	t.is(invoked[0]?.request.prompt, 'is CI green?');
	t.deepEqual(adapter.replies, ['all green']);
	t.true(logs.some(l => /Channels running for \/repo: telegram, discord/.test(l)));
	t.true(logs.some(l => /pid 4242/.test(l)));

	release();
	const result = await run;
	t.deepEqual(result, {exitCode: 0, output: 'Channels stopped.'});
	t.is(adapter.stopped, 1);
});

test('start surfaces an adapter that refuses its credentials', async t => {
	const adapter = new StubAdapter();
	adapter.start = async () => {
		throw new Error('Telegram getMe failed (HTTP 401): Unauthorized');
	};

	const result = await runChannelsCli('start', {
		projectRoot: '/repo',
		deps: deps({createAdapters: () => [adapter]}),
	});

	t.is(result.exitCode, 1);
	t.regex(result.output, /telegram failed to start: .*401/);
});

test('config warnings reach the user from both start and status', async t => {
	const warnings = ['nanocoder.channels: telegram.token is missing; channel disabled'];
	const logged: string[] = [];

	const started = await runChannelsCli('start', {
		projectRoot: '/repo',
		deps: deps({
			configWarnings: () => warnings,
			loadConfig: () => ({}),
			logger: {info: () => {}, warn: m => logged.push(m), error: () => {}},
		}),
	});
	t.is(started.exitCode, 1);
	t.deepEqual(logged, warnings);

	const status = await runChannelsCli('status', {
		projectRoot: '/repo',
		deps: deps({configWarnings: () => warnings}),
	});
	t.is(status.output.split('\n')[0], `warning: ${warnings[0]}`);
	t.regex(status.output, /telegram: 1 allowed user/);
});

test('status lists each configured platform and the daemon state', async t => {
	const running = await runChannelsCli('status', {projectRoot: '/repo', deps: deps()});
	t.is(running.exitCode, 0);
	t.deepEqual(running.output.split('\n'), [
		'telegram: 1 allowed user, headless mode',
		'discord: 2 allowed users, 1 open chat, plan mode',
		'Daemon: running (pid 4242).',
	]);

	const stopped = await runChannelsCli('status', {
		projectRoot: '/repo',
		deps: deps({readLiveLockfile: async () => null}),
	});
	t.regex(stopped.output, /Daemon: not running/);

	const none = await runChannelsCli('status', {
		projectRoot: '/repo',
		deps: deps({loadConfig: () => ({})}),
	});
	t.is(none.exitCode, 0);
	t.regex(none.output, /No chat channels are configured/);
});
