/**
 * The policy layer between chat adapters and the daemon.
 *
 * Every inbound message passes through the same gate regardless of
 * platform: the sender must be in `allowedUsers`; outside a DM the bot must
 * have been @-mentioned (unless the chat is in `allowedChats`); one run per
 * chat at a time. What survives becomes a `prompt` request to the daemon,
 * with a bounded transcript of the same chat prepended so "now fix the
 * second one" means something, and the answer is split to the platform's
 * message limit on the way back.
 *
 * The bridge never touches a token or a socket - adapters do - and never
 * runs a model - the daemon does. That keeps it fully testable with fakes.
 */

import type {PromptRequest, PromptResult} from '@/daemon/prompt-runner';
import type {ChannelPlatform, ChannelsConfig} from '@/types/config';
import {formatError} from '@/utils/error-formatter';
import {
	DEFAULT_CHANNEL_HISTORY_TURNS,
	DEFAULT_CHANNEL_TIMEOUT_MS,
} from './config';
import {splitMessage} from './format';
import {
	type ChannelAdapter,
	type ChannelLogger,
	type InboundMessage,
	silentLogger,
} from './types';

export type PromptInvoker = (request: PromptRequest) => Promise<PromptResult>;

export interface ChannelBridgeOptions {
	adapters: ChannelAdapter[];
	/** Hand a prompt to the daemon. The CLI wires this to the IPC client. */
	invoke: PromptInvoker;
	config: ChannelsConfig;
	/** Shown in `/help`; typically the project root. */
	projectLabel?: string;
	logger?: ChannelLogger;
}

interface Exchange {
	user: string;
	assistant: string;
}

/** Characters of each remembered turn carried into the next prompt. */
const HISTORY_TURN_CLIP = 1500;

const BUSY_REPLY =
	'Still working on your previous message. Send this one again once I have replied.';
const EMPTY_REPLY = 'Done. The agent finished without a written summary.';

export class ChannelBridge {
	private readonly adapters: ChannelAdapter[];
	private readonly invoke: PromptInvoker;
	private readonly config: ChannelsConfig;
	private readonly logger: ChannelLogger;
	private readonly projectLabel: string;
	private readonly historyTurns: number;
	private readonly timeoutMs: number;
	/** Chats with a run in flight, keyed `platform:chatId`. */
	private readonly inFlight = new Set<string>();
	private readonly history = new Map<string, Exchange[]>();
	private started: ChannelAdapter[] = [];

	constructor(options: ChannelBridgeOptions) {
		this.adapters = options.adapters;
		this.invoke = options.invoke;
		this.config = options.config;
		this.logger = options.logger ?? silentLogger;
		this.projectLabel = options.projectLabel ?? 'this project';
		this.historyTurns =
			options.config.historyTurns ?? DEFAULT_CHANNEL_HISTORY_TURNS;
		this.timeoutMs = options.config.timeoutMs ?? DEFAULT_CHANNEL_TIMEOUT_MS;
	}

	/**
	 * Start every adapter. If one refuses (bad token), the ones already up
	 * are stopped again and the error propagates, so `channels start` either
	 * runs everything it was asked to or nothing.
	 */
	async start(): Promise<void> {
		for (const adapter of this.adapters) {
			try {
				await adapter.start(message => this.handle(adapter, message));
			} catch (err) {
				await this.stop();
				throw new Error(
					`${adapter.platform} failed to start: ${formatError(err)}`,
				);
			}
			this.started.push(adapter);
			this.logger.info(`${adapter.platform}: connected`);
		}
	}

	async stop(): Promise<void> {
		const started = this.started;
		this.started = [];
		for (const adapter of started.reverse()) {
			try {
				await adapter.stop();
			} catch (err) {
				this.logger.warn(
					`${adapter.platform}: stop failed: ${formatError(err)}`,
				);
			}
		}
	}

	/**
	 * Exposed for the spec. Production traffic arrives through the handler
	 * passed to each adapter's `start`.
	 */
	async handle(
		adapter: ChannelAdapter,
		message: InboundMessage,
	): Promise<void> {
		const platformConfig = this.config[adapter.platform];
		if (!platformConfig) return;

		const who = describeSender(message);
		if (!platformConfig.allowedUsers.includes(message.userId)) {
			this.logger.warn(
				`${adapter.platform}: ignored message from ${who} (not in allowedUsers)`,
			);
			return;
		}

		const text = message.text.trim();
		if (!text) return;

		const chatAllowed =
			platformConfig.allowedChats?.includes(message.chatId) ?? false;
		if (!message.isDirect && !message.mentioned && !chatAllowed) return;

		const key = `${adapter.platform}:${message.chatId}`;
		const command = parseCommand(text);
		if (command === 'help') {
			await this.send(adapter, message, this.helpText(adapter.platform));
			return;
		}
		if (command === 'reset') {
			this.history.delete(key);
			await this.send(adapter, message, "Forgot this chat's earlier messages.");
			return;
		}

		if (this.inFlight.has(key)) {
			await this.send(adapter, message, BUSY_REPLY);
			return;
		}
		this.inFlight.add(key);
		try {
			this.logger.info(`${adapter.platform}: run started for ${who}`);
			if (adapter.indicateTyping) {
				await adapter.indicateTyping(message).catch(() => {});
			}

			const prompt = buildPrompt(this.history.get(key) ?? [], text);
			const request: PromptRequest = {
				prompt,
				mode: platformConfig.mode ?? 'headless',
				source: `${adapter.platform}:${message.userId}`,
			};

			const result = await withTimeout(this.invoke(request), this.timeoutMs);

			if (result.success) {
				const output = result.output.trim() || EMPTY_REPLY;
				this.remember(key, text, output);
				this.logger.info(
					`${adapter.platform}: run ok for ${who} (${result.durationMs}ms)`,
				);
				await this.send(adapter, message, output);
			} else {
				this.logger.warn(
					`${adapter.platform}: run failed for ${who}: ${result.error ?? 'unknown error'}`,
				);
				await this.send(
					adapter,
					message,
					`The run failed: ${result.error ?? 'unknown error'}`,
				);
			}
		} catch (err) {
			const detail = formatError(err);
			this.logger.error(`${adapter.platform}: ${detail}`);
			await this.send(adapter, message, failureReply(err, this.timeoutMs));
		} finally {
			this.inFlight.delete(key);
		}
	}

	private remember(key: string, user: string, assistant: string): void {
		if (this.historyTurns === 0) return;
		const turns = this.history.get(key) ?? [];
		turns.push({user, assistant});
		while (turns.length > this.historyTurns) turns.shift();
		this.history.set(key, turns);
	}

	private async send(
		adapter: ChannelAdapter,
		to: InboundMessage,
		text: string,
	): Promise<void> {
		for (const chunk of splitMessage(text, adapter.maxMessageLength)) {
			try {
				await adapter.reply(to, chunk);
			} catch (err) {
				this.logger.error(
					`${adapter.platform}: reply to ${to.chatId} failed: ${formatError(err)}`,
				);
				return;
			}
		}
	}

	private helpText(platform: ChannelPlatform): string {
		const platformConfig = this.config[platform];
		const mode = platformConfig?.mode ?? 'headless';
		const lines = [
			`I relay your messages to the Nanocoder daemon for ${this.projectLabel}.`,
			mode === 'plan'
				? 'This channel runs in plan mode: I describe what I would do without changing files.'
				: 'Runs execute tools unattended, so each one is checkpointed first; revert with /checkpoint in the terminal.',
			'',
			'/help - this message',
			'/reset - forget the earlier messages in this chat',
		];
		return lines.join('\n');
	}
}

/**
 * `/help`, `/start` (Telegram sends it on first contact), `/reset`, with
 * the `@botname` suffix Telegram adds in groups. Slack swallows unknown
 * slash commands before they reach a bot, so the bare words work too.
 */
function parseCommand(text: string): 'help' | 'reset' | null {
	if (/\s/.test(text)) return null;
	const word = text.toLowerCase().replace(/@\S+$/, '');
	if (word === '/help' || word === '/start' || word === 'help') return 'help';
	if (word === '/reset' || word === 'reset') return 'reset';
	return null;
}

export function buildPrompt(history: Exchange[], text: string): string {
	if (history.length === 0) return text;
	const lines = ['Earlier messages in this chat, oldest first:'];
	for (const turn of history) {
		lines.push(
			`User: ${clip(turn.user)}`,
			`Assistant: ${clip(turn.assistant)}`,
		);
	}
	lines.push('', 'The user now says:', text);
	return lines.join('\n');
}

function clip(value: string): string {
	return value.length > HISTORY_TURN_CLIP
		? `${value.slice(0, HISTORY_TURN_CLIP)}…`
		: value;
}

class BridgeTimeoutError extends Error {
	constructor(ms: number) {
		super(`timed out after ${ms}ms waiting for the daemon`);
		this.name = 'BridgeTimeoutError';
	}
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new BridgeTimeoutError(ms)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

function failureReply(err: unknown, timeoutMs: number): string {
	if (err instanceof BridgeTimeoutError) {
		const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
		return `No answer from the daemon after ${minutes} minute${minutes === 1 ? '' : 's'}. The run may still be going; check \`nanocoder daemon logs\`.`;
	}
	return `Could not reach the daemon: ${formatError(err)}`;
}

function describeSender(message: InboundMessage): string {
	return message.userName
		? `${message.userName} (${message.userId})`
		: message.userId;
}
