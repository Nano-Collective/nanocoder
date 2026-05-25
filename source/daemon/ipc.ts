/**
 * Daemon IPC: a tiny Unix-socket RPC server that lets a TUI ask the
 * running daemon "what subscriptions are active?".
 *
 * Protocol: newline-delimited JSON. Each request is one line of
 * `{id, method, params?}`; each response is `{id, result | error}`.
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

export interface IpcRequest {
	id: number;
	method: 'listSubscriptions' | 'ping' | 'shutdown';
	params?: unknown;
}

export interface IpcResponse {
	id: number;
	result?: unknown;
	error?: string;
}

export interface IpcHandlers {
	listSubscriptions(): Subscription[];
	/**
	 * Optional - if supplied, the IPC server exposes a `shutdown` method
	 * that triggers a graceful daemon stop. Lets clients ask the daemon
	 * to wind down its own event loop without relying on SIGTERM (which
	 * is force-kill on Windows).
	 */
	shutdown?: () => void | Promise<void>;
}

export class DaemonIpcServer {
	private server: Server | null = null;
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
			this.server?.once('error', reject);
			this.server?.listen(this.socketPath, () => resolve());
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
		await new Promise<void>(resolve => s.close(() => resolve()));
		if (existsSync(this.socketPath)) {
			try {
				unlinkSync(this.socketPath);
			} catch {
				/* best-effort */
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
			this.clients.delete(socket);
		});
		socket.on('error', () => {
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
				case 'shutdown':
					if (!this.handlers.shutdown) {
						this.respond(
							socket,
							req.id,
							undefined,
							'shutdown method not enabled on this daemon',
						);
						return;
					}
					// Acknowledge before firing the stop so the client gets a clean
					// response. The stop callback is fire-and-forget from this
					// handler's perspective - the daemon process will exit when its
					// own event loop drains.
					this.respond(socket, req.id, {accepted: true});
					void Promise.resolve(this.handlers.shutdown()).catch(() => {});
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
 * the matching response.
 */
export class DaemonIpcClient {
	private socket: Socket | null = null;
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{resolve: (v: unknown) => void; reject: (err: Error) => void}
	>();
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

	async ping(): Promise<string> {
		return (await this.request('ping')) as string;
	}

	/**
	 * Ask the daemon to shut down. Returns when the daemon has acknowledged
	 * the request (not when it has finished stopping). The caller should
	 * then poll the lockfile / process for actual termination.
	 */
	async shutdown(): Promise<{accepted: true}> {
		return (await this.request('shutdown')) as {accepted: true};
	}

	private async request(
		method: IpcRequest['method'],
		params?: unknown,
	): Promise<unknown> {
		if (!this.socket) throw new Error('IPC client not connected');
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, {resolve, reject});
			this.socket?.write(
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
			let parsed: IpcResponse;
			try {
				parsed = JSON.parse(line) as IpcResponse;
			} catch {
				continue;
			}
			const slot = this.pending.get(parsed.id);
			if (!slot) continue;
			this.pending.delete(parsed.id);
			if (parsed.error) slot.reject(new Error(parsed.error));
			else slot.resolve(parsed.result);
		}
	}

	private handleClose(): void {
		for (const slot of this.pending.values()) {
			slot.reject(new Error('IPC connection closed'));
		}
		this.pending.clear();
	}
}
