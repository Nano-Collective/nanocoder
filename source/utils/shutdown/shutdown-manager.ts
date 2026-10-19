import nodeProcess from 'node:process';

import {loggerProvider} from '@/utils/logging/logger-provider';
import type {ShutdownHandler, ShutdownManagerOptions} from './types';

const DEFAULT_TIMEOUT_MS = 5000;
const ENV_SHUTDOWN_TIMEOUT = 'NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT';

export class ShutdownManager {
	private handlers: Map<string, ShutdownHandler> = new Map();
	private isShuttingDown = false;
	private exitCode = 0;
	private timeoutMs: number;

	private boundSigterm: () => void;
	private boundSigint: () => void;
	private boundUncaughtException: (err: Error) => void;
	private boundUnhandledRejection: (
		reason: unknown,
		promise: Promise<unknown>,
	) => void;

	constructor(options?: ShutdownManagerOptions) {
		const envTimeout = nodeProcess.env[ENV_SHUTDOWN_TIMEOUT];
		const parsedEnvTimeout = envTimeout ? parseInt(envTimeout, 10) : undefined;
		const isValidTimeout = Number.isFinite(parsedEnvTimeout);
		this.timeoutMs =
			options?.timeoutMs ??
			(isValidTimeout ? parsedEnvTimeout : undefined) ??
			DEFAULT_TIMEOUT_MS;

		this.boundSigterm = () => {
			void this.gracefulShutdown(0);
		};
		this.boundSigint = () => {
			void this.gracefulShutdown(0);
		};
		this.boundUncaughtException = (err: Error) => {
			// Fallback if logger creation fails (e.g., process global corrupted).
			try {
				const logger = loggerProvider.getLogger();
				logger.fatal({err}, 'Uncaught exception');
			} catch {
				nodeProcess.stderr.write(
					`Uncaught exception (logger unavailable): ${err.stack ?? err.message}\n`,
				);
			}
			this.failFromUnhandledError();
		};
		this.boundUnhandledRejection = (
			reason: unknown,
			promise: Promise<unknown>,
		) => {
			try {
				const logger = loggerProvider.getLogger();
				logger.fatal({reason, promise}, 'Unhandled promise rejection');
			} catch {
				const detail =
					reason instanceof Error
						? (reason.stack ?? reason.message)
						: String(reason);
				nodeProcess.stderr.write(
					`Unhandled promise rejection (logger unavailable): ${detail}\n`,
				);
			}
			this.failFromUnhandledError();
		};

		this.setupSignalHandlers();
	}

	register(handler: ShutdownHandler): void {
		this.handlers.set(handler.name, handler);
	}

	unregister(name: string): void {
		this.handlers.delete(name);
	}

	/**
	 * Apply an explicit timeout even if another subsystem created the singleton.
	 * Applies to shutdowns that start after this call; a shutdown already in
	 * flight keeps the timeout it started with.
	 */
	setTimeoutMs(timeoutMs: number): void {
		this.timeoutMs = timeoutMs;
	}

	async gracefulShutdown(exitCode = 0): Promise<void> {
		if (this.isShuttingDown) {
			// A failure reported while a clean shutdown is already under way must
			// not be lost: a `run` aborted by the same SIGTERM reports exit 1, and
			// the signal's shutdown would otherwise exit 0. The first failure wins.
			if (exitCode !== 0 && this.exitCode === 0) {
				this.exitCode = exitCode;
			}
			return;
		}
		this.isShuttingDown = true;
		this.exitCode = exitCode;

		const logger = loggerProvider.getLogger();
		logger.info('Graceful shutdown initiated', {exitCode});

		const sorted = Array.from(this.handlers.values()).sort(
			(a, b) => a.priority - b.priority,
		);

		const shutdownPromise = (async () => {
			for (const entry of sorted) {
				try {
					logger.info(`Shutting down: ${entry.name}`);
					await entry.handler();
				} catch (err) {
					logger.error({err}, `Shutdown handler failed: ${entry.name}`);
				}
			}
		})();

		const timeoutPromise = new Promise<void>(resolve => {
			setTimeout(() => {
				logger.warn('Shutdown timeout reached, forcing exit');
				resolve();
			}, this.timeoutMs);
		});

		await Promise.race([shutdownPromise, timeoutPromise]);

		nodeProcess.exit(this.exitCode);
	}

	/**
	 * An unhandled error starts a failing shutdown. During a shutdown that is
	 * already under way it is only logged: tearing things down (closing MCP
	 * connections, aborting requests) can reject on its own, and that must not
	 * turn a clean exit into a failure.
	 */
	private failFromUnhandledError(): void {
		if (this.isShuttingDown) return;
		void this.gracefulShutdown(1);
	}

	private setupSignalHandlers(): void {
		nodeProcess.once('SIGTERM', this.boundSigterm);
		nodeProcess.once('SIGINT', this.boundSigint);
		nodeProcess.on('uncaughtException', this.boundUncaughtException);
		nodeProcess.on('unhandledRejection', this.boundUnhandledRejection);
	}

	reset(): void {
		this.handlers.clear();
		this.isShuttingDown = false;
		this.exitCode = 0;
		nodeProcess.removeListener('SIGTERM', this.boundSigterm);
		nodeProcess.removeListener('SIGINT', this.boundSigint);
		nodeProcess.removeListener(
			'uncaughtException',
			this.boundUncaughtException,
		);
		nodeProcess.removeListener(
			'unhandledRejection',
			this.boundUnhandledRejection,
		);
	}
}

let instance: ShutdownManager | null = null;

export function getShutdownManager(
	options?: ShutdownManagerOptions,
): ShutdownManager {
	if (!instance) {
		instance = new ShutdownManager(options);
	} else if (options?.timeoutMs !== undefined) {
		instance.setTimeoutMs(options.timeoutMs);
	}
	return instance;
}

export function resetShutdownManager(): void {
	if (instance) {
		instance.reset();
		instance = null;
	}
}
