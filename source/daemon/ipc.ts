/**
 * Daemon IPC: a tiny Unix-socket RPC server that lets a TUI ask the
 * running daemon "what subscriptions are active?" and subscribe to a
 * stream of triggered-run activity events.
 *
 * Protocol: newline-delimited JSON. Each request is one line of
 * `{id, method, params?}`; each response is `{id, result | error}`.
 * Activity broadcasts are `{event: 'activity', payload}` (no id).
 *
 * Kept deliberately small - no msgpack, no schema validation library,
 * no auth. The socket lives inside `.nanocoder/` so it inherits the
 * project root's filesystem permissions.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 19.
 */

import {existsSync, unlinkSync} from 'node:fs';
import {
	createConnection,
	createServer,
	type Server,
	type Socket,
} from 'node:net';
import type {Subscription} from '@/events/types';
import type {TriggeredRunActivity} from '@/skills/dispatcher';

export interface IpcRequest {
	id: number;
	method: 'listSubscriptions' | 'subscribeActivity' | 'ping';
	params?: unknown;
}

export interface IpcResponse {
	id: number;
	result?: unknown;
	error?: string;
}

export interface IpcActivityBroadcast {
	event: 'activity';
	payload: SerializedActivity;
}

export type IpcMessage = IpcResponse | IpcActivityBroadcast;

/**
 * Activity wire format. `TriggeredRunActivity` references types (events,
 * subscriptions, results) that all serialize cleanly to JSON, so we just
 * pass it through - this alias documents the contract.
 */
export type SerializedActivity = TriggeredRunActivity;

export interface IpcHandlers {
	listSubscriptions(): Subscription[];
}

export class DaemonIpcServer {
	private server: Server | null = null;
	private readonly activitySubscribers: Set<Socket> = new Set();
	/** All connected sockets - used to force-close on stop(). */
	private readonly clients: Set<Socket> = new Set();

	constructor(
		private readonly socketPath: string,
		private readonly handlers: IpcHandlers,
	) {}

	async start(): Promise<void> {
		if (this.server) return;
		// Stale socket from a prior crashed run blocks listen(). The lockfile
		// has already been reaped at this point if the prior daemon is dead.
		if (existsSync(this.socketPath)) {
			try {
				unlinkSync(this.socketPath);
			} catch {
				/* best-effort */
			}
		}
		this.server = createServer(socket => this.attachClient(socket));
		await new Promise<void>((resolve, reject) => {
			this.server!.once('error', reject);
			this.server!.listen(this.socketPath, () => resolve());
		});
	}

	async stop(): Promise<void> {
		if (!this.server) return;
		const s = this.server;
		this.server = null;
		// Force-close every connected socket so server.close() doesn't block
		// on in-flight connections. Then unlink the socket file ourselves -
		// Node's server.close() doesn't remove the path entry.
		for (const sock of this.clients) sock.destroy();
		this.clients.clear();
		this.activitySubscribers.clear();
		await new Promise<void>(resolve => s.close(() => resolve()));
		if (existsSync(this.socketPath)) {
			try {
				unlinkSync(this.socketPath);
			} catch {
				/* best-effort */
			}
		}
	}

	/**
	 * Broadcast a `TriggeredRunActivity` to every client that subscribed.
	 * Quiet by design: dead sockets are dropped without raising.
	 */
	broadcastActivity(activity: TriggeredRunActivity): void {
		const line = `${JSON.stringify({event: 'activity', payload: activity} satisfies IpcActivityBroadcast)}\n`;
		for (const sock of this.activitySubscribers) {
			try {
				sock.write(line);
			} catch {
				this.activitySubscribers.delete(sock);
			}
		}
	}

	private attachClient(socket: Socket): void {
		socket.setEncoding('utf-8');
		this.clients.add(socket);
		let buffer = '';
		socket.on('data', chunk => {
			buffer += chunk;
			let nl: number;
			while ((nl = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				if (!line.trim()) continue;
				this.handleLine(socket, line);
			}
		});
		socket.on('close', () => {
			this.activitySubscribers.delete(socket);
			this.clients.delete(socket);
		});
		socket.on('error', () => {
			this.activitySubscribers.delete(socket);
			this.clients.delete(socket);
		});
	}

	private handleLine(socket: Socket, line: string): void {
		let req: IpcRequest;
		try {
			req = JSON.parse(line) as IpcRequest;
		} catch {
			socket.write(
				`${JSON.stringify({
					id: 0,
					error: 'invalid JSON',
				} satisfies IpcResponse)}\n`,
			);
			return;
		}

		try {
			switch (req.method) {
				case 'ping':
					this.respond(socket, req.id, 'pong');
					return;
				case 'listSubscriptions':
					this.respond(socket, req.id, this.handlers.listSubscriptions());
					return;
				case 'subscribeActivity':
					this.activitySubscribers.add(socket);
					this.respond(socket, req.id, {subscribed: true});
					return;
				default:
					this.respond(
						socket,
						req.id,
						undefined,
						`unknown method: ${req.method as string}`,
					);
			}
		} catch (err) {
			this.respond(
				socket,
				req.id,
				undefined,
				err instanceof Error ? err.message : String(err),
			);
		}
	}

	private respond(
		socket: Socket,
		id: number,
		result: unknown,
		error?: string,
	): void {
		const msg: IpcResponse = {id, ...(error ? {error} : {result})};
		try {
			socket.write(`${JSON.stringify(msg)}\n`);
		} catch {
			/* socket closed - drop */
		}
	}
}

/**
 * Minimal client for the TUI side. Sends a single request and resolves on
 * the matching response. Activity subscription is a separate one-shot
 * `subscribeActivity` followed by streaming reads via `onActivity`.
 */
export class DaemonIpcClient {
	private socket: Socket | null = null;
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{resolve: (v: unknown) => void; reject: (err: Error) => void}
	>();
	private activityListeners: Array<(a: TriggeredRunActivity) => void> = [];
	private buffer = '';

	constructor(private readonly socketPath: string) {}

	async connect(): Promise<void> {
		if (this.socket) return;
		await new Promise<void>((resolve, reject) => {
			const s = createConnection(this.socketPath);
			s.setEncoding('utf-8');
			s.once('error', reject);
			s.once('connect', () => {
				this.socket = s;
				s.on('data', chunk => this.handleData(String(chunk)));
				s.on('close', () => this.handleClose());
				resolve();
			});
		});
	}

	async disconnect(): Promise<void> {
		if (!this.socket) return;
		const s = this.socket;
		this.socket = null;
		await new Promise<void>(resolve => {
			s.end(() => resolve());
		});
	}

	async listSubscriptions(): Promise<Subscription[]> {
		return (await this.request('listSubscriptions')) as Subscription[];
	}

	async subscribeActivity(
		listener: (activity: TriggeredRunActivity) => void,
	): Promise<void> {
		this.activityListeners.push(listener);
		await this.request('subscribeActivity');
	}

	async ping(): Promise<string> {
		return (await this.request('ping')) as string;
	}

	private async request(
		method: IpcRequest['method'],
		params?: unknown,
	): Promise<unknown> {
		if (!this.socket) throw new Error('IPC client not connected');
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, {resolve, reject});
			this.socket!.write(
				`${JSON.stringify({id, method, params} satisfies IpcRequest)}\n`,
			);
		});
	}

	private handleData(chunk: string): void {
		this.buffer += chunk;
		let nl: number;
		while ((nl = this.buffer.indexOf('\n')) !== -1) {
			const line = this.buffer.slice(0, nl);
			this.buffer = this.buffer.slice(nl + 1);
			if (!line.trim()) continue;
			let parsed: IpcMessage;
			try {
				parsed = JSON.parse(line) as IpcMessage;
			} catch {
				continue;
			}
			if ('event' in parsed && parsed.event === 'activity') {
				for (const l of this.activityListeners) l(parsed.payload);
				continue;
			}
			const resp = parsed as IpcResponse;
			const slot = this.pending.get(resp.id);
			if (!slot) continue;
			this.pending.delete(resp.id);
			if (resp.error) slot.reject(new Error(resp.error));
			else slot.resolve(resp.result);
		}
	}

	private handleClose(): void {
		for (const slot of this.pending.values()) {
			slot.reject(new Error('IPC connection closed'));
		}
		this.pending.clear();
	}
}
