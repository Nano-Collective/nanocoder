/**
 * The slice of a WebSocket the Slack and Discord adapters use, so a spec
 * can stand in a scripted fake for the real `ws` client.
 */

import {WebSocket} from 'ws';

export interface SocketLike {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	on(event: 'open', listener: () => void): unknown;
	on(event: 'message', listener: (data: unknown) => void): unknown;
	on(
		event: 'close',
		listener: (code: number, reason?: unknown) => void,
	): unknown;
	on(event: 'error', listener: (error: Error) => void): unknown;
}

export type SocketFactory = (url: string) => SocketLike;

export const defaultSocketFactory: SocketFactory = url => new WebSocket(url);

/** `ws` hands frames over as Buffers; a fake may send strings. */
export function frameToString(data: unknown): string {
	if (typeof data === 'string') return data;
	if (Array.isArray(data))
		return Buffer.concat(data as Buffer[]).toString('utf-8');
	if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf-8');
	return String(data);
}
