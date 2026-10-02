/**
 * Discord adapter: the Gateway over a WebSocket, replies via the REST API.
 *
 * Reading message text needs the privileged **Message Content** intent, so
 * it must be switched on under Bot → Privileged Gateway Intents in the
 * developer portal; the gateway closes with 4014 otherwise, and that is
 * reported as a fatal error rather than retried. Invite the bot with the
 * `bot` scope and the Send Messages, Read Message History, and View
 * Channels permissions. Enable Developer Mode in Discord to copy your user
 * id for `allowedUsers`.
 *
 * The gateway contract implemented here: HELLO → IDENTIFY (or RESUME),
 * heartbeat every `heartbeat_interval` with the last sequence number,
 * reconnect-and-resume on op 7 and on a missed heartbeat ack, fresh
 * identify on a non-resumable op 9.
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

export interface DiscordAdapterOptions {
	token: string;
	apiBase?: string;
	fetchImpl?: FetchLike;
	createSocket?: SocketFactory;
	/** First reconnect delay; doubles up to 30s. */
	reconnectDelayMs?: number;
	logger?: ChannelLogger;
}

// GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);

const enum Op {
	Dispatch = 0,
	Heartbeat = 1,
	Identify = 2,
	Resume = 6,
	Reconnect = 7,
	InvalidSession = 9,
	Hello = 10,
	HeartbeatAck = 11,
}

/** Close codes after which reconnecting cannot help. */
const FATAL_CLOSE_CODES = new Map<number, string>([
	[4004, 'authentication failed - check the bot token'],
	[4010, 'invalid shard'],
	[
		4011,
		'sharding required - this bot is in too many guilds for one connection',
	],
	[4012, 'invalid API version'],
	[4013, 'invalid intents'],
	[
		4014,
		'disallowed intents - enable "Message Content Intent" for the bot in the Discord developer portal',
	],
]);

/** Close codes that invalidate the session; the next connect must identify. */
const SESSION_LOST_CLOSE_CODES = new Set([4007, 4009]);

/** Code we close with ourselves so the session stays resumable. */
const CLIENT_CLOSE_CODE = 4000;

const MAX_RECONNECT_DELAY_MS = 30_000;

interface GatewayFrame {
	op: number;
	d?: unknown;
	s?: number | null;
	t?: string | null;
}

interface DiscordMessage {
	id: string;
	channel_id: string;
	guild_id?: string;
	content?: string;
	author?: {id: string; username?: string; bot?: boolean};
	mentions?: Array<{id: string}>;
}

export class DiscordAdapter implements ChannelAdapter {
	readonly platform: ChannelPlatform = 'discord';
	readonly maxMessageLength = 2000;

	private readonly token: string;
	private readonly apiBase: string;
	private readonly fetchImpl: FetchLike | undefined;
	private readonly createSocket: SocketFactory;
	private readonly baseReconnectDelayMs: number;
	private readonly logger: ChannelLogger;

	private socket: SocketLike | null = null;
	private onMessage: InboundHandler | null = null;
	private stopped = true;
	private gatewayUrl = '';
	private resumeUrl: string | null = null;
	private sessionId: string | null = null;
	private seq: number | null = null;
	private botUserId = '';
	private heartbeat: NodeJS.Timeout | null = null;
	private acked = true;
	private reconnectDelayMs: number;
	private reconnectTimer: NodeJS.Timeout | null = null;

	constructor(options: DiscordAdapterOptions) {
		this.token = options.token;
		this.apiBase = (options.apiBase ?? 'https://discord.com/api/v10').replace(
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
		// Authenticated, so a bad token fails here with a clear 401 instead
		// of a bare 4004 close code later.
		const gateway = (await this.rest('GET', '/gateway/bot')) as {url?: string};
		if (!gateway.url) throw new Error('Discord /gateway/bot returned no url');
		this.gatewayUrl = gateway.url;
		this.connect();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.stopHeartbeat();
		const socket = this.socket;
		this.socket = null;
		socket?.close(1000, 'stopping');
	}

	async reply(to: InboundMessage, text: string): Promise<void> {
		const body: Record<string, unknown> = {
			content: text,
			// The model's reply may quote `<@...>` or `@everyone` verbatim; never
			// let that ping anyone.
			allowed_mentions: {parse: []},
		};
		if (!to.isDirect && to.messageId) {
			body.message_reference = {
				message_id: to.messageId,
				fail_if_not_exists: false,
			};
		}
		await this.rest('POST', `/channels/${to.chatId}/messages`, body);
	}

	async indicateTyping(to: InboundMessage): Promise<void> {
		await this.rest('POST', `/channels/${to.chatId}/typing`);
	}

	private connect(): void {
		const base =
			this.sessionId && this.resumeUrl ? this.resumeUrl : this.gatewayUrl;
		const url = `${base.replace(/\/+$/, '')}/?v=10&encoding=json`;
		const socket = this.createSocket(url);
		this.socket = socket;
		this.acked = true;
		socket.on('message', data => this.handleFrame(socket, frameToString(data)));
		socket.on('error', err => {
			this.logger.warn(`discord: socket error: ${formatError(err)}`);
		});
		socket.on('close', code => this.handleClose(socket, code));
	}

	private handleClose(socket: SocketLike, code: number): void {
		if (this.socket === socket) {
			this.socket = null;
			this.stopHeartbeat();
		}
		if (this.stopped) return;

		const fatal = FATAL_CLOSE_CODES.get(code);
		if (fatal) {
			this.logger.error(
				`discord: gateway closed (${code}): ${fatal}. Not reconnecting.`,
			);
			return;
		}
		if (SESSION_LOST_CLOSE_CODES.has(code)) this.forgetSession();
		this.logger.warn(`discord: gateway closed (${code}); reconnecting`);
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		if (this.stopped || this.reconnectTimer) return;
		const delay = this.reconnectDelayMs;
		this.reconnectDelayMs = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (this.stopped) return;
			try {
				this.connect();
			} catch (err) {
				this.logger.warn(`discord: reconnect failed: ${formatError(err)}`);
				this.scheduleReconnect();
			}
		}, delay);
	}

	private handleFrame(socket: SocketLike, raw: string): void {
		let frame: GatewayFrame;
		try {
			frame = JSON.parse(raw);
		} catch {
			return;
		}
		if (typeof frame.s === 'number') this.seq = frame.s;

		switch (frame.op) {
			case Op.Hello: {
				const interval = (frame.d as {heartbeat_interval?: number})
					?.heartbeat_interval;
				this.startHeartbeat(socket, interval ?? 41_250);
				if (this.sessionId) {
					this.send(socket, Op.Resume, {
						token: this.token,
						session_id: this.sessionId,
						seq: this.seq,
					});
				} else {
					this.send(socket, Op.Identify, {
						token: this.token,
						intents: INTENTS,
						properties: {
							os: process.platform,
							browser: 'nanocoder',
							device: 'nanocoder',
						},
					});
				}
				return;
			}
			case Op.HeartbeatAck:
				this.acked = true;
				return;
			case Op.Heartbeat:
				this.send(socket, Op.Heartbeat, this.seq);
				return;
			case Op.Reconnect:
				// Discord is moving us; close resumably and come back.
				socket.close(CLIENT_CLOSE_CODE, 'reconnect requested');
				return;
			case Op.InvalidSession:
				if (frame.d !== true) this.forgetSession();
				socket.close(CLIENT_CLOSE_CODE, 'invalid session');
				return;
			case Op.Dispatch:
				this.handleDispatch(frame.t ?? '', frame.d);
				return;
			default:
				return;
		}
	}

	private handleDispatch(event: string, data: unknown): void {
		switch (event) {
			case 'READY': {
				const ready = data as {
					session_id?: string;
					resume_gateway_url?: string;
					user?: {id?: string};
				};
				this.sessionId = ready.session_id ?? null;
				this.resumeUrl = ready.resume_gateway_url ?? null;
				this.botUserId = ready.user?.id ?? this.botUserId;
				this.reconnectDelayMs = this.baseReconnectDelayMs;
				this.logger.info('discord: gateway ready');
				return;
			}
			case 'RESUMED':
				this.reconnectDelayMs = this.baseReconnectDelayMs;
				this.logger.info('discord: session resumed');
				return;
			case 'MESSAGE_CREATE':
				this.handleMessage(data as DiscordMessage);
				return;
			default:
				return;
		}
	}

	private handleMessage(message: DiscordMessage): void {
		if (!message?.author || message.author.bot) return;
		if (message.author.id === this.botUserId) return;
		if (typeof message.content !== 'string') return;

		const mentioned =
			message.mentions?.some(user => user.id === this.botUserId) ?? false;
		const text = mentioned
			? message.content
					.replace(new RegExp(`<@!?${this.botUserId}>`, 'g'), '')
					.replace(/\s{2,}/g, ' ')
					.trim()
			: message.content.trim();

		const inbound: InboundMessage = {
			platform: 'discord',
			chatId: message.channel_id,
			userId: message.author.id,
			userName: message.author.username,
			text,
			messageId: message.id,
			isDirect: !message.guild_id,
			mentioned,
		};
		void Promise.resolve(this.onMessage?.(inbound)).catch(err => {
			this.logger.error(`discord: handler failed: ${formatError(err)}`);
		});
	}

	private startHeartbeat(socket: SocketLike, intervalMs: number): void {
		this.stopHeartbeat();
		this.acked = true;
		this.heartbeat = setInterval(() => {
			if (this.socket !== socket) {
				this.stopHeartbeat();
				return;
			}
			if (!this.acked) {
				// Zombie connection: Discord stopped answering. Close resumably
				// and let the close handler reconnect.
				this.logger.warn('discord: heartbeat not acknowledged; reconnecting');
				socket.close(CLIENT_CLOSE_CODE, 'heartbeat timeout');
				return;
			}
			this.acked = false;
			this.send(socket, Op.Heartbeat, this.seq);
		}, intervalMs);
	}

	private stopHeartbeat(): void {
		if (this.heartbeat) {
			clearInterval(this.heartbeat);
			this.heartbeat = null;
		}
	}

	private forgetSession(): void {
		this.sessionId = null;
		this.resumeUrl = null;
		this.seq = null;
	}

	private send(socket: SocketLike, op: Op, d: unknown): void {
		try {
			socket.send(JSON.stringify({op, d}));
		} catch (err) {
			this.logger.warn(`discord: send failed: ${formatError(err)}`);
		}
	}

	private async rest(
		method: 'GET' | 'POST',
		path: string,
		body?: Record<string, unknown>,
	): Promise<unknown> {
		const {status, body: payload} = await requestJson(
			`${this.apiBase}${path}`,
			{
				method,
				headers: {authorization: `Bot ${this.token}`},
				body,
				fetchImpl: this.fetchImpl,
			},
		);
		if (status >= 400) {
			const detail =
				payload && typeof payload === 'object'
					? ((payload as {message?: string}).message ?? JSON.stringify(payload))
					: String(payload);
			throw new Error(
				`Discord ${method} ${path} failed (HTTP ${status}): ${detail}`,
			);
		}
		return payload;
	}
}
