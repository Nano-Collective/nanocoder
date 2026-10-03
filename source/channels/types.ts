/**
 * Shared contract between the chat-platform adapters and the bridge.
 *
 * An adapter knows one platform's wire protocol and nothing about the
 * agent: it turns inbound traffic into `InboundMessage`s and sends plain
 * text back. The bridge (`bridge.ts`) owns every policy decision -
 * allowlists, mention gating, per-chat history, chunking - so the three
 * adapters stay thin and behave identically.
 */

import type {ChannelPlatform} from '@/types/config';

export interface InboundMessage {
	platform: ChannelPlatform;
	/** Chat, channel, or DM the message arrived in. Replies go back here. */
	chatId: string;
	/** Platform user id of the sender. Matched against `allowedUsers`. */
	userId: string;
	/** Display name, for logs only. */
	userName?: string;
	/** Message body with any @-mention of the bot already stripped. */
	text: string;
	/** Platform message id, so replies can quote or thread. */
	messageId?: string;
	/** Thread the message belongs to, when the platform has threads. */
	threadId?: string;
	/** True in a 1:1 chat with the bot. */
	isDirect: boolean;
	/** True when the message @-mentioned the bot or replied to it. */
	mentioned: boolean;
}

export type InboundHandler = (message: InboundMessage) => void | Promise<void>;

export interface ChannelAdapter {
	readonly platform: ChannelPlatform;
	/** Longest message body the platform accepts in one send. */
	readonly maxMessageLength: number;
	/**
	 * Connect and begin delivering messages. Rejects when the platform turns
	 * the credentials down, so a bad token fails `channels start` loudly
	 * instead of silently reconnecting forever.
	 */
	start(onMessage: InboundHandler): Promise<void>;
	stop(): Promise<void>;
	/** Send one chunk back to where `to` came from. */
	reply(to: InboundMessage, text: string): Promise<void>;
	/** Optional "working on it" signal while a run is in flight. */
	indicateTyping?(to: InboundMessage): Promise<void>;
}

export interface ChannelLogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export const silentLogger: ChannelLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
};
