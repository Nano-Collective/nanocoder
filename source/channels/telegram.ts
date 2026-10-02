/**
 * Telegram adapter: Bot API over plain `fetch`, long-polling `getUpdates`.
 *
 * No inbound port is needed - the bot pulls updates - which is the point of
 * the whole feature: the daemon stays on the user's machine behind whatever
 * NAT it is behind, and only the outbound HTTPS call leaves it.
 *
 * Setup: create a bot with @BotFather, put the token under
 * `nanocoder.channels.telegram.token`, and list your numeric user id in
 * `allowedUsers` (send `/start` to @userinfobot to learn it). In groups,
 * Telegram's privacy mode only delivers commands, @-mentions, and replies to
 * the bot unless it is disabled in BotFather.
 */

import type {ChannelPlatform} from '@/types/config';
import {formatError} from '@/utils/error-formatter';
import {type FetchLike, requestJson} from './http';
import {
	type ChannelAdapter,
	type ChannelLogger,
	type InboundHandler,
	type InboundMessage,
	silentLogger,
} from './types';

export interface TelegramAdapterOptions {
	token: string;
	/** Long-poll wait, in seconds. Telegram caps it at 50. */
	pollTimeoutSeconds?: number;
	apiBase?: string;
	fetchImpl?: FetchLike;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	logger?: ChannelLogger;
}

interface TelegramUser {
	id: number;
	username?: string;
	first_name?: string;
}

interface TelegramMessage {
	message_id: number;
	text?: string;
	from?: TelegramUser;
	chat?: {id: number; type: string};
	reply_to_message?: {from?: TelegramUser};
}

interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
}

const MAX_BACKOFF_MS = 30_000;

export class TelegramAdapter implements ChannelAdapter {
	readonly platform: ChannelPlatform = 'telegram';
	readonly maxMessageLength = 4096;

	private readonly token: string;
	private readonly apiBase: string;
	private readonly pollTimeoutSeconds: number;
	private readonly fetchImpl: FetchLike | undefined;
	private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
	private readonly logger: ChannelLogger;

	private offset = 0;
	private botId = 0;
	private botUsername = '';
	private abort: AbortController | null = null;
	private loop: Promise<void> | null = null;

	constructor(options: TelegramAdapterOptions) {
		this.token = options.token;
		this.apiBase = (options.apiBase ?? 'https://api.telegram.org').replace(
			/\/+$/,
			'',
		);
		this.pollTimeoutSeconds = options.pollTimeoutSeconds ?? 30;
		this.fetchImpl = options.fetchImpl;
		this.sleep = options.sleep ?? abortableSleep;
		this.logger = options.logger ?? silentLogger;
	}

	async start(onMessage: InboundHandler): Promise<void> {
		if (this.loop) return;
		const me = (await this.call('getMe')) as TelegramUser;
		this.botId = me.id;
		this.botUsername = me.username ?? '';
		const abort = new AbortController();
		this.abort = abort;
		this.loop = this.poll(onMessage, abort.signal);
	}

	async stop(): Promise<void> {
		this.abort?.abort();
		await this.loop?.catch(() => {});
		this.abort = null;
		this.loop = null;
	}

	async reply(to: InboundMessage, text: string): Promise<void> {
		const body: Record<string, unknown> = {chat_id: to.chatId, text};
		// Quote the message in groups so the answer is attributable; in a DM
		// the quote is just noise.
		if (!to.isDirect && to.messageId) {
			body.reply_parameters = {
				message_id: Number(to.messageId),
				allow_sending_without_reply: true,
			};
		}
		await this.call('sendMessage', body);
	}

	async indicateTyping(to: InboundMessage): Promise<void> {
		await this.call('sendChatAction', {chat_id: to.chatId, action: 'typing'});
	}

	private async poll(
		onMessage: InboundHandler,
		signal: AbortSignal,
	): Promise<void> {
		let backoff = 1000;
		while (!signal.aborted) {
			try {
				const updates = (await this.call(
					'getUpdates',
					{
						offset: this.offset,
						timeout: this.pollTimeoutSeconds,
						allowed_updates: ['message'],
					},
					signal,
				)) as TelegramUpdate[];
				backoff = 1000;
				for (const update of updates) {
					this.offset = Math.max(this.offset, update.update_id + 1);
					const message = this.toInbound(update.message);
					if (!message) continue;
					// Deliberately not awaited: a run can take minutes, and the
					// poll loop must keep draining so Telegram does not redeliver.
					void Promise.resolve(onMessage(message)).catch(err => {
						this.logger.error(`telegram: handler failed: ${formatError(err)}`);
					});
				}
			} catch (err) {
				if (signal.aborted) break;
				this.logger.warn(
					`telegram: polling failed (${formatError(err)}); retrying in ${backoff}ms`,
				);
				await this.sleep(backoff, signal).catch(() => {});
				backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
			}
		}
	}

	private toInbound(
		message: TelegramMessage | undefined,
	): InboundMessage | null {
		if (!message || typeof message.text !== 'string') return null;
		if (!message.from || !message.chat) return null;
		if (message.from.id === this.botId) return null;

		const isDirect = message.chat.type === 'private';
		let text = message.text;
		let mentioned = false;

		if (this.botUsername) {
			const mention = new RegExp(`@${escapeRegExp(this.botUsername)}\\b`, 'gi');
			if (mention.test(text)) {
				mentioned = true;
				text = text
					.replace(mention, '')
					.replace(/\s{2,}/g, ' ')
					.trim();
			}
		}
		if (message.reply_to_message?.from?.id === this.botId) mentioned = true;

		return {
			platform: 'telegram',
			chatId: String(message.chat.id),
			userId: String(message.from.id),
			userName: message.from.username ?? message.from.first_name,
			text,
			messageId: String(message.message_id),
			isDirect,
			mentioned,
		};
	}

	/**
	 * Call a Bot API method. The token lives in the URL, so errors are built
	 * from the response body only and never echo the URL.
	 */
	private async call(
		method: string,
		body?: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<unknown> {
		const {status, body: payload} = await requestJson(
			`${this.apiBase}/bot${this.token}/${method}`,
			{
				method: 'POST',
				body: body ?? {},
				signal,
				fetchImpl: this.fetchImpl,
				sleep: ms => this.sleep(ms, signal),
			},
		);
		const response = (payload ?? {}) as {
			ok?: boolean;
			result?: unknown;
			description?: string;
		};
		if (!response.ok) {
			throw new Error(
				`Telegram ${method} failed (HTTP ${status}): ${response.description ?? 'no error description'}`,
			);
		}
		return response.result;
	}
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error('aborted'));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error('aborted'));
		};
		signal?.addEventListener('abort', onAbort, {once: true});
	});
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
