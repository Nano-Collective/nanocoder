import nodeProcess from 'node:process';

import {loggerProvider} from '@/utils/logging/logger-provider';
import type {ShutdownHandler, ShutdownManagerOptions} from './types';

const DEFAULT_TIMEOUT_MS = 5000;
const ENV_SHUTDOWN_TIMEOUT = 'NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT';

export class ShutdownManager {
	private handlers: Map<string, ShutdownHandler> = new Map();
	private isShuttingDown = false;
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
			// The logger itself reads the `process` global (env config, fallback
			// config); when that global has been clobbered by third-party code
			// (see #1553) building the logger throws and masks the original
			// error, so the handler must never depend on it succeeding.
			try {
				const logger = loggerProvider.getLogger();
				logger.fatal({err}, 'Uncaught exception');
			} catch {
				nodeProcess.stderr.write(
					`Uncaught exception (logger unavailable): ${err.stack ?? err.message}\n`,
				);
			}
			void this.gracefulShutdown(1);
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
			void this.gracefulShutdown(1);
		};

		this.setupSignalHandlers();
	}

	register(handler: ShutdownHandler): void {
		this.handlers.set(handler.name, handler);
	}

	unregister(name: string): void {
		this.handlers.delete(name);
	}

	async gracefulShutdown(exitCode = 0): Promise<void> {
		if (this.isShuttingDown) {
			return;
		}
		this.isShuttingDown = true;

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

		nodeProcess.exit(exitCode);
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
	}
	return instance;
}

export function resetShutdownManager(): void {
	if (instance) {
		instance.reset();
		instance = null;
	}
}
