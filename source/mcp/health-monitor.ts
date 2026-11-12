import type {Client} from '@modelcontextprotocol/sdk/client/index.js';
import type {MCPHealthChange, MCPHealthStatus, MCPServer} from '@/types/index';
import {formatError} from '@/utils/error-formatter';
import {getLogger} from '@/utils/logging';

/** The transport callbacks the monitor chains onto. */
export type LifecycleTransport = {
	onclose?: () => void;
	onerror?: (error: Error) => void;
};

type TimerHandle = ReturnType<typeof setTimeout>;

/** Timer functions, injectable so tests can drive time by hand. */
export interface HealthTimers {
	setTimeout(callback: () => void, delay: number): TimerHandle;
	clearTimeout(handle: TimerHandle): void;
}

const systemTimers: HealthTimers = {
	setTimeout: (callback, delay) => setTimeout(callback, delay),
	clearTimeout: handle => clearTimeout(handle),
};

/**
 * What the monitor needs from the connection owner (MCPClient). The monitor
 * owns health status, ping scheduling and reconnect backoff; the owner keeps
 * the connections and the discovered tools/resources/prompts.
 */
export interface HealthMonitorHost {
	/** True while the owner is closing this server on purpose. */
	isClosing(serverName: string): boolean;
	/** The client currently registered for the server, if any. */
	getClient(serverName: string): Client | undefined;
	getConfig(serverName: string): MCPServer | undefined;
	/** Drop the server's tools, resources and prompts. */
	clearCatalog(serverName: string): void;
	/**
	 * Re-list the server's tools (and resources/prompts it declares) on a
	 * client that answered again. Resolves to the tool count; rejects if the
	 * tool list could not be fetched.
	 */
	rediscover(serverName: string, client: Client): Promise<number>;
	/** Build a fresh connection from the stored config. */
	reconnect(config: MCPServer): Promise<void>;
	/** Close and drop one server's connection and all of its state. */
	forget(serverName: string): Promise<void>;
	/** Bumped by the owner on shutdown; see MCPClient.lifecycleEpoch. */
	lifecycleEpoch(): number;
}

const DEFAULT_BASE_DELAY = 30_000;
const MAX_DELAY = 300_000;

/**
 * Delay before the next ping or reconnect attempt: the base delay doubled
 * per consecutive failure, capped at 8x and at five minutes.
 */
export function backoffDelay(base: number, failures: number): number {
	const multiplier = failures > 0 ? Math.min(2 ** (failures - 1), 8) : 1;
	return Math.min(base * multiplier, MAX_DELAY);
}

function isLivenessResponse(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const code = (error as {code?: number}).code;
	// JSON-RPC MethodNotFound (-32601) means the server received the ping and responded
	return code === -32601;
}

/**
 * Tracks each MCP server's health, pings it on an interval, and rebuilds
 * connections that cannot recover by pinging (closed transports, lost
 * remote sessions), backing off exponentially between attempts.
 */
export class MCPHealthMonitor {
	private health: Map<string, MCPHealthStatus> = new Map();
	private healthErrors: Map<string, string> = new Map();
	private healthTimers: Map<string, TimerHandle> = new Map();
	private healthFailureCounts: Map<string, number> = new Map();
	private healthChecksInFlight = new Set<string>();
	private healthListeners = new Set<(change: MCPHealthChange) => void>();
	/** Tool calls / resource reads currently awaiting a response, per server. */
	private inFlightRequests = new Map<string, number>();
	private reconnectTimers: Map<string, TimerHandle> = new Map();
	private reconnectAttempts = new Map<string, number>();
	private logger = getLogger();
	private readonly timers: HealthTimers;

	constructor(
		private readonly host: HealthMonitorHost,
		timers: HealthTimers = systemTimers,
	) {
		this.timers = timers;
	}

	onChange(listener: (change: MCPHealthChange) => void): () => void {
		this.healthListeners.add(listener);
		return () => this.healthListeners.delete(listener);
	}

	getStatus(serverName: string): MCPHealthStatus | undefined {
		return this.health.get(serverName);
	}

	getError(serverName: string): string | undefined {
		return this.healthErrors.get(serverName);
	}

	/** Consecutive failed pings since the last successful one. */
	getFailureCount(serverName: string): number {
		return this.healthFailureCounts.get(serverName) ?? 0;
	}

	/** Failed reconnect attempts since the server was last connected. */
	getReconnectAttempts(serverName: string): number {
		return this.reconnectAttempts.get(serverName) ?? 0;
	}

	isPingScheduled(serverName: string): boolean {
		return this.healthTimers.has(serverName);
	}

	isReconnectScheduled(serverName: string): boolean {
		return this.reconnectTimers.has(serverName);
	}

	getInFlightCount(serverName: string): number {
		return this.inFlightRequests.get(serverName) ?? 0;
	}

	/**
	 * Record a status change and tell listeners. The first `connected` of a
	 * server is not an event, nor is a repeat of the current status.
	 */
	setStatus(
		serverName: string,
		status: MCPHealthStatus,
		error?: unknown,
	): void {
		const errorMessage = error ? formatError(error) : undefined;
		const previousStatus = this.health.get(serverName);
		const previousError = this.healthErrors.get(serverName);
		this.health.set(serverName, status);
		if (errorMessage) this.healthErrors.set(serverName, errorMessage);
		else this.healthErrors.delete(serverName);
		if (previousStatus === undefined && status === 'connected') return;
		if (previousStatus === status && previousError === errorMessage) return;
		for (const listener of this.healthListeners) {
			listener({serverName, status, error: errorMessage});
		}
	}

	markUnhealthy(serverName: string, error?: unknown): void {
		if (this.host.isClosing(serverName)) return;
		this.setStatus(serverName, 'unhealthy', error);
		this.host.clearCatalog(serverName);
	}

	async trackInFlight<T>(
		serverName: string,
		request: () => Promise<T>,
	): Promise<T> {
		this.inFlightRequests.set(
			serverName,
			(this.inFlightRequests.get(serverName) ?? 0) + 1,
		);
		try {
			return await request();
		} finally {
			const remaining = (this.inFlightRequests.get(serverName) ?? 1) - 1;
			if (remaining > 0) this.inFlightRequests.set(serverName, remaining);
			else this.inFlightRequests.delete(serverName);
		}
	}

	/** Cancel the server's pending ping and reconnect. */
	stop(serverName: string): void {
		this.clearHealthTimer(serverName);
		this.clearReconnect(serverName);
	}

	/** Forget the server's ping bookkeeping (failure count, ping in flight). */
	clearCheckState(serverName: string): void {
		this.healthFailureCounts.delete(serverName);
		this.healthChecksInFlight.delete(serverName);
	}

	/** Forget everything about one server except in-flight requests. */
	forget(serverName: string): void {
		this.health.delete(serverName);
		this.healthErrors.delete(serverName);
		this.clearCheckState(serverName);
	}

	/** Clear all state after the owner has stopped every server. */
	reset(): void {
		this.health.clear();
		this.healthErrors.clear();
		this.healthChecksInFlight.clear();
		this.inFlightRequests.clear();
	}

	/**
	 * Remote (HTTP / WebSocket) transports can lose their session without the
	 * transport ever closing, so ping-based recovery may never succeed. Stdio
	 * servers keep the old behaviour: their transport closes when the child
	 * exits, which already triggers a reconnect.
	 */
	private isRemoteServer(serverName: string): boolean {
		const transport = this.host.getConfig(serverName)?.transport;
		return transport !== undefined && transport !== 'stdio';
	}

	/**
	 * A Streamable HTTP server answers 404 for a session it no longer knows,
	 * typically because it restarted. The MCP spec says the client must start
	 * a new session; pinging with the old session id can never succeed.
	 */
	private isSessionGoneResponse(serverName: string, error: unknown): boolean {
		if (!this.isRemoteServer(serverName)) return false;
		if (!error || typeof error !== 'object') return false;
		if ((error as {code?: unknown}).code === 404) return true;
		const message = (error as {message?: unknown}).message;
		return typeof message === 'string' && /session not found/i.test(message);
	}

	private async restoreServerHealth(
		serverName: string,
		client: Client,
	): Promise<void> {
		if (this.host.isClosing(serverName)) return;

		try {
			const toolCount = await this.host.rediscover(serverName, client);
			this.setStatus(serverName, 'connected');
			this.logger.info(
				`MCP server "${serverName}" recovered and restored tools`,
				{
					serverName,
					toolCount,
				},
			);
		} catch (error) {
			this.logger.warn(
				`Failed to rediscover tools for recovered MCP server "${serverName}"`,
				{
					serverName,
					error: formatError(error),
				},
			);
		}
	}

	/**
	 * Base delay for a server's health checks and reconnect attempts. Backoff
	 * multiplies this, so a server with periodic checks disabled
	 * (`healthCheckInterval: 0`) still reconnects on the default cadence.
	 */
	private getHealthBaseDelay(serverName: string): number {
		const interval = this.host.getConfig(serverName)?.healthCheckInterval;
		return typeof interval === 'number' && interval > 0
			? interval
			: DEFAULT_BASE_DELAY;
	}

	private schedule(callback: () => void, delay: number): TimerHandle {
		const timer = this.timers.setTimeout(callback, delay);
		if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref();
		return timer;
	}

	private clearHealthTimer(serverName: string): void {
		const timer = this.healthTimers.get(serverName);
		if (timer) this.timers.clearTimeout(timer);
		this.healthTimers.delete(serverName);
	}

	private clearReconnect(serverName: string): void {
		const timer = this.reconnectTimers.get(serverName);
		if (timer) this.timers.clearTimeout(timer);
		this.reconnectTimers.delete(serverName);
		this.reconnectAttempts.delete(serverName);
	}

	/**
	 * After a transport closes the SDK client drops its transport for good:
	 * every later ping fails with "Not connected", so ping-based recovery can
	 * never succeed. Rebuild the connection from the stored config instead,
	 * backing off exponentially between attempts.
	 */
	private scheduleReconnect(serverName: string): void {
		if (
			this.host.isClosing(serverName) ||
			this.reconnectTimers.has(serverName) ||
			!this.host.getConfig(serverName)
		) {
			return;
		}
		const attempts = this.reconnectAttempts.get(serverName) ?? 0;
		const delay = backoffDelay(
			this.getHealthBaseDelay(serverName),
			attempts + 1,
		);
		const timer = this.schedule(
			() => void this.attemptReconnect(serverName),
			delay,
		);
		this.reconnectTimers.set(serverName, timer);
	}

	private async attemptReconnect(serverName: string): Promise<void> {
		this.reconnectTimers.delete(serverName);
		const config = this.host.getConfig(serverName);
		if (
			!config ||
			this.host.isClosing(serverName) ||
			this.health.get(serverName) !== 'unhealthy'
		) {
			this.reconnectAttempts.delete(serverName);
			return;
		}
		const epoch = this.host.lifecycleEpoch();
		const previousClient = this.host.getClient(serverName);
		try {
			await this.host.reconnect(config);
		} catch (error) {
			if (
				epoch !== this.host.lifecycleEpoch() ||
				this.host.isClosing(serverName)
			) {
				return;
			}
			this.reconnectAttempts.set(
				serverName,
				(this.reconnectAttempts.get(serverName) ?? 0) + 1,
			);
			this.logger.warn(`MCP server "${serverName}" reconnect failed`, {
				serverName,
				attempt: this.reconnectAttempts.get(serverName),
				error: formatError(error),
			});
			this.scheduleReconnect(serverName);
			return;
		}

		if (epoch !== this.host.lifecycleEpoch()) {
			// The owner shut down while we were connecting: undo this connection.
			await this.host.forget(serverName);
			return;
		}

		this.reconnectAttempts.delete(serverName);
		this.logger.info(`MCP server "${serverName}" reconnected`, {serverName});
		// The old client's transport is already gone; closing it just releases
		// anything the SDK still holds. Its handlers ignore events now that it
		// is no longer the registered client.
		if (previousClient && previousClient !== this.host.getClient(serverName)) {
			previousClient.close().catch(error => {
				this.logger.debug('Error closing replaced MCP client', {
					serverName,
					error: formatError(error),
				});
			});
		}
	}

	/**
	 * Start watching a freshly connected server: ping it every `interval` ms
	 * (0 disables periodic pings), and chain onto the transport's close and
	 * error callbacks.
	 */
	watch(
		serverName: string,
		client: Client,
		transport: LifecycleTransport,
		interval: number,
		pingOptions?: {timeout: number},
	): void {
		// Events from a client that has since been replaced by a reconnect (or
		// dropped entirely) must not touch the current connection's state.
		const isCurrent = () => {
			const current = this.host.getClient(serverName);
			return current === undefined || current === client;
		};
		const scheduleNext = (delay: number) => {
			if (
				this.host.isClosing(serverName) ||
				interval <= 0 ||
				typeof client.ping !== 'function' ||
				!isCurrent()
			) {
				return;
			}
			this.clearHealthTimer(serverName);
			const timer = this.schedule(() => void check(), delay);
			this.healthTimers.set(serverName, timer);
		};
		const check = async () => {
			const currentStatus = this.health.get(serverName);
			if (
				this.host.isClosing(serverName) ||
				!isCurrent() ||
				(currentStatus !== 'connected' && currentStatus !== 'unhealthy') ||
				this.healthChecksInFlight.has(serverName) ||
				this.reconnectTimers.has(serverName) ||
				typeof client.ping !== 'function'
			) {
				return;
			}
			// A long-running tool call or resource read occupies the server; a
			// ping queued behind it can time out even though the server is
			// fine. A request in flight on a live transport counts as alive.
			if ((this.inFlightRequests.get(serverName) ?? 0) > 0) {
				scheduleNext(interval);
				return;
			}
			this.healthChecksInFlight.add(serverName);
			try {
				await client.ping(pingOptions ?? {timeout: 10_000});
				if (this.health.get(serverName) === 'unhealthy') {
					await this.restoreServerHealth(serverName, client);
				}
				this.healthFailureCounts.delete(serverName);
			} catch (error) {
				if (isLivenessResponse(error)) {
					if (this.health.get(serverName) === 'unhealthy') {
						await this.restoreServerHealth(serverName, client);
					}
					this.healthFailureCounts.delete(serverName);
				} else {
					const currentFailures =
						(this.healthFailureCounts.get(serverName) ?? 0) + 1;
					this.healthFailureCounts.set(serverName, currentFailures);
					const status = this.health.get(serverName);
					const sessionGone = this.isSessionGoneResponse(serverName, error);
					// One missed ping is not enough to pull a server's tools
					// mid-turn; require two in a row. A pending ping can also
					// reject after an intentional disconnect, hence the status check.
					// A lost session is final, so it does not wait for a second miss.
					if (
						(currentFailures >= 2 || sessionGone) &&
						status === 'connected' &&
						isCurrent()
					) {
						this.markUnhealthy(serverName, error);
					}
					// A remote server whose recovery ping failed, or whose session is
					// gone, may have restarted: the old session will never answer
					// again and HTTP never fires onclose. Rebuild the connection
					// through the reconnect loop instead of pinging on.
					if (
						(sessionGone || status === 'unhealthy') &&
						this.isRemoteServer(serverName) &&
						this.health.get(serverName) === 'unhealthy' &&
						isCurrent() &&
						!this.host.isClosing(serverName)
					) {
						this.clearHealthTimer(serverName);
						this.healthFailureCounts.delete(serverName);
						this.scheduleReconnect(serverName);
					}
				}
			} finally {
				this.healthChecksInFlight.delete(serverName);
				if (
					!this.host.isClosing(serverName) &&
					// Handed to the reconnect loop: the new client runs its own checks.
					!this.reconnectTimers.has(serverName)
				) {
					const failureCount = this.healthFailureCounts.get(serverName) ?? 0;
					scheduleNext(backoffDelay(interval, failureCount));
				}
			}
		};
		const previousOnClose = transport.onclose;
		const previousOnError = transport.onerror;
		transport.onclose = () => {
			try {
				previousOnClose?.();
			} finally {
				if (!this.host.isClosing(serverName) && isCurrent()) {
					this.markUnhealthy(serverName, new Error('MCP transport closed'));
					// Pings against a closed transport can never succeed; hand the
					// server over to the reconnect loop.
					this.clearHealthTimer(serverName);
					this.healthFailureCounts.delete(serverName);
					this.scheduleReconnect(serverName);
				}
			}
		};
		transport.onerror = error => {
			try {
				previousOnError?.(error);
			} finally {
				// HTTP/SSE errors can be recoverable; let the SDK handle the error
				// before confirming liveness with a bounded ping. Deferring also
				// prevents a ping's own transport error from starting another ping.
				// With health checks disabled there is nothing to schedule a
				// recovery ping, so do not ping (and risk marking unhealthy) here.
				if (interval > 0) void Promise.resolve().then(check);
			}
		};
		if (interval <= 0 || typeof client.ping !== 'function') return;
		scheduleNext(interval);
	}
}
