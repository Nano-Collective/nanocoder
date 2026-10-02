/**
 * Slack adapter: Socket Mode over a WebSocket, replies via the Web API.
 *
 * Socket Mode is outbound-only, like Telegram's long polling, so no public
 * URL or Request URL verification is involved. The app needs an app-level
 * token with `connections:write` (for the socket) and a bot token with
 * `chat:write`, `app_mentions:read`, `im:history`, and, to answer in
 * channels it was added to, `channels:history` (`reactions:write` is
 * optional and turns on the 👀 acknowledgement). Subscribe the app to the
 * `message.im`, `app_mention`, and `message.channels` events.
 *
 * Mentions in a channel arrive as both `app_mention` and `message`, so
 * events are de-duplicated on `channel:ts` before they reach the bridge.
 */

import type {ChannelPlatform} from '@/types/config';
import {formatError} from '@/utils/error-formatter';
import {type FetchLike, requestJson} from './http';
import {
	defaultSocketFactory,
	frameToString,
	type SocketFactory,
	type SocketLike,
} from './socket';
import {
	type ChannelAdapter,
	type ChannelLogger,
	type InboundHandler,
	type InboundMessage,
	silentLogger,
} from './types';

export interface SlackAdapterOptions {
	botToken: string;
	appToken: string;
	apiBase?: string;
	fetchImpl?: FetchLike;
	createSocket?: SocketFactory;
	/** First reconnect delay; doubles up to 30s. */
	reconnectDelayMs?: number;
	logger?: ChannelLogger;
}

interface SlackEvent {
	type?: string;
	subtype?: string;
	bot_id?: string;
	user?: string;
	channel?: string;
	channel_type?: string;
	text?: string;
	ts?: string;
	thread_ts?: string;
}

const MAX_RECONNECT_DELAY_MS = 30_000;
const SEEN_LIMIT = 500;

export class SlackAdapter implements ChannelAdapter {
	readonly platform: ChannelPlatform = 'slack';
	/** Slack accepts ~40k, but anything past this renders as a "show more" wall. */
	readonly maxMessageLength = 4000;

	private readonly botToken: string;
	private readonly appToken: string;
	private readonly apiBase: string;
	private readonly fetchImpl: FetchLike | undefined;
	private readonly createSocket: SocketFactory;
	private readonly baseReconnectDelayMs: number;
	private readonly logger: ChannelLogger;

	private socket: SocketLike | null = null;
	private onMessage: InboundHandler | null = null;
	private botUserId = '';
	private stopped = true;
	private reconnectDelayMs: number;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private readonly seen: string[] = [];

	constructor(options: SlackAdapterOptions) {
		this.botToken = options.botToken;
		this.appToken = options.appToken;
		this.apiBase = (options.apiBase ?? 'https://slack.com/api').replace(
			/\/+$/,
			'',
		);
		this.fetchImpl = options.fetchImpl;
		this.createSocket = options.createSocket ?? defaultSocketFactory;
		this.baseReconnectDelayMs = options.reconnectDelayMs ?? 1000;
		this.reconnectDelayMs = this.baseReconnectDelayMs;
		this.logger = options.logger ?? silentLogger;
	}

	async start(onMessage: InboundHandler): Promise<void> {
		if (!this.stopped) return;
		this.stopped = false;
		this.onMessage = onMessage;
		// auth.test validates the bot token up front and tells us our own user
		// id, which mention detection needs.
		const auth = (await this.api('auth.test')) as {user_id?: string};
		this.botUserId = auth.user_id ?? '';
		await this.connect();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		const socket = this.socket;
		this.socket = null;
		socket?.close(1000, 'stopping');
	}

	async reply(to: InboundMessage, text: string): Promise<void> {
		const body: Record<string, unknown> = {channel: to.chatId, text};
		// Thread replies in channels so a long answer does not flood the
		// channel; in a DM a thread would only hide the reply.
		const threadTs = to.threadId ?? (to.isDirect ? undefined : to.messageId);
		if (threadTs) body.thread_ts = threadTs;
		await this.api('chat.postMessage', body);
	}

	async indicateTyping(to: InboundMessage): Promise<void> {
		if (!to.messageId) return;
		await this.api('reactions.add', {
			channel: to.chatId,
			name: 'eyes',
			timestamp: to.messageId,
		});
	}

	private async connect(): Promise<void> {
		const open = (await this.api(
			'apps.connections.open',
			undefined,
			this.appToken,
		)) as {url?: string};
		if (!open.url)
			throw new Error('Slack apps.connections.open returned no url');

		const socket = this.createSocket(open.url);
		this.socket = socket;
		socket.on('message', data => this.handleFrame(socket, frameToString(data)));
		socket.on('error', err => {
			this.logger.warn(`slack: socket error: ${formatError(err)}`);
		});
		socket.on('close', code => {
			if (this.socket === socket) this.socket = null;
			if (this.stopped) return;
			this.logger.warn(`slack: socket closed (${code}); reconnecting`);
			this.scheduleReconnect();
		});
	}

	private scheduleReconnect(): void {
		if (this.stopped || this.reconnectTimer) return;
		const delay = this.reconnectDelayMs;
		this.reconnectDelayMs = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (this.stopped) return;
			this.connect().catch(err => {
				this.logger.warn(`slack: reconnect failed: ${formatError(err)}`);
				this.scheduleReconnect();
			});
		}, delay);
	}

	private handleFrame(socket: SocketLike, raw: string): void {
		let frame: {
			type?: string;
			envelope_id?: string;
			payload?: {event?: SlackEvent};
		};
		try {
			frame = JSON.parse(raw);
		} catch {
			return;
		}

		// Slack expects an ack within 3 seconds or it redelivers; ack first,
		// handle after.
		if (frame.envelope_id) {
			socket.send(JSON.stringify({envelope_id: frame.envelope_id}));
		}

		switch (frame.type) {
			case 'hello':
				this.reconnectDelayMs = this.baseReconnectDelayMs;
				return;
			case 'disconnect':
				// Slack is about to drop this socket (refresh or warning); closing
				// it ourselves lets the close handler reconnect promptly.
				socket.close(1000, 'disconnect requested');
				return;
			case 'events_api':
				if (frame.payload?.event) this.handleEvent(frame.payload.event);
				return;
			default:
				return;
		}
	}

	private handleEvent(event: SlackEvent): void {
		if (event.type !== 'message' && event.type !== 'app_mention') return;
		// Edits, joins, file shares, and anything from a bot (including us).
		if (event.subtype || event.bot_id) return;
		if (!event.user || event.user === this.botUserId) return;
		if (!event.channel || !event.ts) return;

		const key = `${event.channel}:${event.ts}`;
		if (this.seen.includes(key)) return;
		this.seen.push(key);
		if (this.seen.length > SEEN_LIMIT) this.seen.shift();

		const {text, mentioned} = stripMention(event.text ?? '', this.botUserId);
		const message: InboundMessage = {
			platform: 'slack',
			chatId: event.channel,
			userId: event.user,
			text,
			messageId: event.ts,
			threadId: event.thread_ts,
			isDirect: event.channel_type === 'im',
			mentioned: mentioned || event.type === 'app_mention',
		};
		void Promise.resolve(this.onMessage?.(message)).catch(err => {
			this.logger.error(`slack: handler failed: ${formatError(err)}`);
		});
	}

	private async api(
		method: string,
		body?: Record<string, unknown>,
		token = this.botToken,
	): Promise<Record<string, unknown>> {
		const {status, body: payload} = await requestJson(
			`${this.apiBase}/${method}`,
			{
				method: 'POST',
				headers: {authorization: `Bearer ${token}`},
				body: body ?? {},
				fetchImpl: this.fetchImpl,
			},
		);
		const response = (payload ?? {}) as {ok?: boolean; error?: string};
		if (!response.ok) {
			throw new Error(
				`Slack ${method} failed (HTTP ${status}): ${response.error ?? 'no error code'}`,
			);
		}
		return response as Record<string, unknown>;
	}
}

/** Remove `<@U123>` / `<@U123|name>` for our own id; report whether it was there. */
function stripMention(
	text: string,
	botUserId: string,
): {text: string; mentioned: boolean} {
	if (!botUserId) return {text: text.trim(), mentioned: false};
	const pattern = new RegExp(`<@${botUserId}(?:\\|[^>]*)?>`, 'g');
	const mentioned = pattern.test(text);
	pattern.lastIndex = 0;
	const stripped = mentioned
		? text
				.replace(pattern, '')
				.replace(/\s{2,}/g, ' ')
				.trim()
		: text.trim();
	return {text: stripped, mentioned};
}
