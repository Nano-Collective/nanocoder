/**
 * CLI surface for `nanocoder channels <start|status>`.
 *
 * `start` is a foreground process: it connects the configured chat
 * platforms, forwards each accepted message to the daemon's `prompt` IPC
 * method, and runs until SIGINT/SIGTERM. It is a client of the daemon, not
 * part of it - the daemon must already be running for the same project, and
 * the bridge re-reads the lockfile on every request so a daemon restart
 * does not strand it.
 *
 * Every handler returns `{exitCode, output}` like the daemon CLI so the
 * wiring in `cli.tsx` stays uniform; `start`'s live log lines go through
 * the logger instead, since they happen while the command is still running.
 */

import {getAppConfig, getChannelsConfigWarnings} from '@/config/index';
import {type DaemonLock, readLiveLockfile} from '@/daemon/lockfile';
import type {PromptRequest, PromptResult} from '@/daemon/prompt-runner';
import type {ChannelsConfig} from '@/types/config';
import {formatError} from '@/utils/error-formatter';
import {ChannelBridge} from './bridge';
import {configuredPlatforms} from './config';
import {DiscordAdapter} from './discord';
import {SlackAdapter} from './slack';
import {TelegramAdapter} from './telegram';
import type {ChannelAdapter, ChannelLogger} from './types';

export const CHANNELS_CLI_USAGE = 'Usage: nanocoder channels <start|status>';

export type ChannelsCliCommand = 'start' | 'status';

export interface ChannelsCliResult {
	exitCode: 0 | 1;
	output: string;
}

export interface ChannelsCliDeps {
	loadConfig: () => ChannelsConfig | undefined;
	/** Why a configured platform was skipped, if any were. */
	configWarnings: () => string[];
	readLiveLockfile: (projectRoot: string) => Promise<DaemonLock | null>;
	createAdapters: (
		config: ChannelsConfig,
		logger: ChannelLogger,
	) => ChannelAdapter[];
	/** Send one prompt to the daemon for `projectRoot`. */
	invoke: (
		projectRoot: string,
		request: PromptRequest,
	) => Promise<PromptResult>;
	/** Resolves when the foreground process should wind down. */
	waitForStop: () => Promise<void>;
	logger: ChannelLogger;
}

export interface ChannelsCliOptions {
	projectRoot: string;
	/** Injectable seams for the spec; production uses the defaults. */
	deps?: Partial<ChannelsCliDeps>;
}

export async function runChannelsCli(
	command: ChannelsCliCommand,
	options: ChannelsCliOptions,
): Promise<ChannelsCliResult> {
	const deps: ChannelsCliDeps = {
		loadConfig: () => getAppConfig().channels,
		configWarnings: getChannelsConfigWarnings,
		readLiveLockfile,
		createAdapters: createDefaultAdapters,
		invoke: invokeOverIpc,
		waitForStop: waitForSignal,
		logger: consoleLogger,
		...options.deps,
	};
	switch (command) {
		case 'start':
			return start(options.projectRoot, deps);
		case 'status':
			return status(options.projectRoot, deps);
	}
}

const NOT_CONFIGURED =
	'No chat channels are configured. Add a `nanocoder.channels` block to agents.config.json with at least one of telegram, slack, or discord (each needs its token and a non-empty allowedUsers list). See docs/features/channels.md.';

async function start(
	projectRoot: string,
	deps: ChannelsCliDeps,
): Promise<ChannelsCliResult> {
	const config = deps.loadConfig();
	// A skipped platform is the most likely "why is my bot silent?" cause, so
	// say so before anything else, even when another platform still starts.
	for (const warning of deps.configWarnings()) deps.logger.warn(warning);
	const platforms = configuredPlatforms(config);
	if (!config || platforms.length === 0) {
		return {exitCode: 1, output: NOT_CONFIGURED};
	}

	const lock = await deps.readLiveLockfile(projectRoot);
	if (!lock) {
		return {
			exitCode: 1,
			output:
				`The daemon is not running for ${projectRoot}. Start it with ` +
				'`nanocoder daemon start`, then run `nanocoder channels start` again from the same directory.',
		};
	}

	const bridge = new ChannelBridge({
		adapters: deps.createAdapters(config, deps.logger),
		invoke: request => deps.invoke(projectRoot, request),
		config,
		projectLabel: projectRoot,
		logger: deps.logger,
	});

	try {
		await bridge.start();
	} catch (err) {
		return {exitCode: 1, output: formatError(err)};
	}

	deps.logger.info(
		`Channels running for ${projectRoot}: ${platforms.join(', ')}. Daemon pid ${lock.pid}. Press Ctrl+C to stop.`,
	);
	await deps.waitForStop();
	await bridge.stop();
	return {exitCode: 0, output: 'Channels stopped.'};
}

async function status(
	projectRoot: string,
	deps: ChannelsCliDeps,
): Promise<ChannelsCliResult> {
	const config = deps.loadConfig();
	const warnings = deps.configWarnings().map(warning => `warning: ${warning}`);
	const platforms = configuredPlatforms(config);
	if (!config || platforms.length === 0) {
		return {exitCode: 0, output: [...warnings, NOT_CONFIGURED].join('\n')};
	}

	const lines = platforms.map(platform => {
		const block = config[platform];
		const users = block?.allowedUsers.length ?? 0;
		const chats = block?.allowedChats?.length ?? 0;
		const mode = block?.mode ?? 'headless';
		return (
			`${platform}: ${users} allowed user${users === 1 ? '' : 's'}` +
			(chats > 0 ? `, ${chats} open chat${chats === 1 ? '' : 's'}` : '') +
			`, ${mode} mode`
		);
	});

	const lock = await deps.readLiveLockfile(projectRoot);
	lines.push(
		lock
			? `Daemon: running (pid ${lock.pid}).`
			: 'Daemon: not running - `nanocoder channels start` needs `nanocoder daemon start` first.',
	);
	return {exitCode: 0, output: [...warnings, ...lines].join('\n')};
}

function createDefaultAdapters(
	config: ChannelsConfig,
	logger: ChannelLogger,
): ChannelAdapter[] {
	const adapters: ChannelAdapter[] = [];
	if (config.telegram) {
		adapters.push(new TelegramAdapter({token: config.telegram.token, logger}));
	}
	if (config.slack) {
		adapters.push(
			new SlackAdapter({
				botToken: config.slack.botToken,
				appToken: config.slack.appToken,
				logger,
			}),
		);
	}
	if (config.discord) {
		adapters.push(new DiscordAdapter({token: config.discord.token, logger}));
	}
	return adapters;
}

/**
 * One connection per prompt. Runs take minutes and the socket is local, so
 * the cost is nil, and reading the lockfile each time means a daemon that
 * was restarted in between is found at its new socket.
 */
async function invokeOverIpc(
	projectRoot: string,
	request: PromptRequest,
): Promise<PromptResult> {
	const lock = await readLiveLockfile(projectRoot);
	if (!lock) {
		throw new Error(
			'the daemon is not running (start it with `nanocoder daemon start`)',
		);
	}
	const {DaemonIpcClient} = await import('@/daemon/ipc');
	const client = new DaemonIpcClient(lock.socketPath);
	await client.connect();
	try {
		return await client.prompt(request);
	} finally {
		await client.disconnect().catch(() => {});
	}
}

function waitForSignal(): Promise<void> {
	return new Promise(resolve => {
		const done = () => {
			process.off('SIGINT', done);
			process.off('SIGTERM', done);
			resolve();
		};
		process.once('SIGINT', done);
		process.once('SIGTERM', done);
	});
}

const consoleLogger: ChannelLogger = {
	info: message => console.log(`${timestamp()} ${message}`),
	warn: message => console.error(`${timestamp()} warning: ${message}`),
	error: message => console.error(`${timestamp()} error: ${message}`),
};

function timestamp(): string {
	return `[${new Date().toTimeString().slice(0, 8)}]`;
}
