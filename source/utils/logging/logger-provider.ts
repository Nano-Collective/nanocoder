/**
 * Logger Provider - Implements dependency injection pattern for logging
 * This file provides centralized logger management without circular dependencies
 */

import {Console} from 'node:console';
import nodeProcess from 'node:process';
import {createConfig} from './config.js';
import {createLogMethods} from './log-method-factory.js';
import {createPinoLogger} from './pino-logger.js';
import type {Logger, LoggerConfig, LogLevel} from './types.js';

const stderrConsole = new Console({
	stdout: nodeProcess.stderr,
	stderr: nodeProcess.stderr,
});

export class LoggerProvider {
	private static instance: LoggerProvider | null = null;
	private _logger: Logger | null = null;
	private _config: LoggerConfig | null = null;
	private _fallbackInitialized = false;

	// Lazy-loaded dependencies
	private _createPinoLogger:
		| ((config?: Partial<LoggerConfig>) => Logger)
		| null = null;
	private _createConfig:
		| ((config?: Partial<LoggerConfig>) => LoggerConfig)
		| null = null;

	private constructor() {
		// Private constructor for singleton pattern
	}

	/**
	 * Detect if running under Bun runtime
	 * Bun's worker threads are incompatible with Pino's transport API
	 */
	private static isBunRuntime(): boolean {
		return typeof (globalThis as Record<string, unknown>).Bun !== 'undefined';
	}

	/**
	 * Get the singleton logger provider instance
	 */
	public static getInstance(): LoggerProvider {
		if (!LoggerProvider.instance) {
			LoggerProvider.instance = new LoggerProvider();
		}
		return LoggerProvider.instance;
	}

	/**
	 * Pick the logger implementation for this process.
	 *
	 * The real Pino file logger is wired in synchronously. It used to be
	 * loaded with a dynamic import, but the first `getLogger()` call always
	 * happened before that import resolved, so the cached logger stayed the
	 * console fallback for the life of the process: nothing reached the log
	 * file, and `NANOCODER_LOG_LEVEL` printed to stdout instead (breaking
	 * `--json` output and ACP's JSON-RPC stream).
	 */
	private ensureDependenciesLoaded() {
		if (this._fallbackInitialized) {
			return;
		}
		this._fallbackInitialized = true;

		// Bun's worker threads are incompatible with Pino's transport API, and
		// under NODE_ENV=test every spec that logs would otherwise write into
		// the user's real log directory. Both keep the stderr fallback logger.
		if (LoggerProvider.isBunRuntime() || nodeProcess.env.NODE_ENV === 'test') {
			this._createPinoLogger = () => this.createFallbackLogger();
			this._createConfig = (config?: Partial<LoggerConfig>) =>
				this.createFallbackConfig(config);
			return;
		}

		this._createPinoLogger = createPinoLogger;
		this._createConfig = createConfig;
	}

	/**
	 * Get the default log level based on environment
	 * Single source of truth for log level defaults (used before config.ts loads)
	 *
	 * IMPORTANT: The fallback logger outputs to console, so in production we use
	 * 'silent' to avoid polluting the UI. Once the real pino logger loads
	 * (which writes to files), it will use 'info' level from config.ts.
	 */
	private getDefaultLogLevel(): LogLevel {
		const envLevel = nodeProcess.env.NANOCODER_LOG_LEVEL as LogLevel;
		if (envLevel) return envLevel;

		return 'silent';
	}

	/**
	 * Create fallback config when config.ts hasn't loaded yet
	 * Uses getDefaultLogLevel() for consistent defaults
	 */
	private createFallbackConfig(
		override: Partial<LoggerConfig> = {},
	): LoggerConfig {
		const isDev = nodeProcess.env.NODE_ENV === 'development';
		const isTest = nodeProcess.env.NODE_ENV === 'test';

		return {
			level: this.getDefaultLogLevel(),
			pretty: isDev,
			redact: ['apiKey', 'token', 'password', 'secret'],
			correlation: !isTest,
			serialize: !isDev,
			...override,
		};
	}

	/**
	 * Create fallback logger when dependencies fail to load
	 */
	private createFallbackLogger(): Logger {
		// Use config level if available, otherwise compute default
		const configLevel = this._config?.level || this.getDefaultLogLevel();
		const isSilent = configLevel === 'silent';

		// If silent, return a no-op logger
		if (isSilent) {
			const noOp = () => {};
			return {
				fatal: noOp,
				error: noOp,
				warn: noOp,
				info: noOp,
				http: noOp,
				debug: noOp,
				trace: noOp,
				child: (_bindings: Record<string, unknown>) =>
					this.createFallbackLogger(),
				isLevelEnabled: (_level: string) => false,
				flush: async () => Promise.resolve(),
				flushSync: () => {},
				end: async () => Promise.resolve(),
			};
		}

		// stderr only: stdout carries `--json` results and ACP's JSON-RPC
		// stream, and console.info/debug would write there.
		const fallbackConsole = stderrConsole;

		// Create all log methods using the factory
		const logMethods = createLogMethods(fallbackConsole, {
			consolePrefix: '',
			transformArgs: (args, _level, _msg) => {
				// Note: Level prefix is handled by consolePrefix option in createLogMethod
				return args;
			},
		});

		return {
			...logMethods,
			child: (_bindings: Record<string, unknown>) =>
				this.createFallbackLogger(),
			isLevelEnabled: (_level: string) => true,
			flush: async () => Promise.resolve(),
			flushSync: () => {},
			end: async () => Promise.resolve(),
		};
	}

	/**
	 * Create default configuration based on environment
	 * Delegates to config.ts when loaded, otherwise uses createFallbackConfig
	 */
	private createDefaultConfig(
		override: Partial<LoggerConfig> = {},
	): LoggerConfig {
		// Use the loaded createConfig from config.ts if available
		if (this._createConfig) {
			return this._createConfig(override);
		}

		// Fallback to local config creation (same logic as createFallbackConfig)
		return this.createFallbackConfig(override);
	}

	/**
	 * Initialize the logger with configuration
	 */
	public initializeLogger(config?: Partial<LoggerConfig>): Logger {
		if (this._logger) {
			return this._logger;
		}

		this.ensureDependenciesLoaded();
		this._config = this.createDefaultConfig(config);
		this._logger =
			this._createPinoLogger?.(this._config) ?? this.createFallbackLogger();

		return this._logger;
	}

	/**
	 * Get the current logger instance
	 */
	public getLogger(): Logger {
		if (!this._logger) {
			// Auto-initialize with defaults if not already done
			return this.initializeLogger();
		}
		return this._logger;
	}

	/**
	 * Get the current configuration
	 */
	public getLoggerConfig(): LoggerConfig | null {
		return this._config;
	}

	/**
	 * Create a child logger with additional context
	 */
	public createChildLogger(bindings: Record<string, unknown>): Logger {
		const parent = this.getLogger();
		return parent.child(bindings);
	}

	/**
	 * Check if a log level is enabled
	 */
	public isLevelEnabled(level: LogLevel): boolean {
		const logger = this.getLogger();
		return logger.isLevelEnabled(level);
	}

	/**
	 * Reset the logger instance (useful for testing)
	 */
	public reset(): void {
		this._logger = null;
		this._config = null;
		this._fallbackInitialized = false;
		this._createPinoLogger = null;
		this._createConfig = null;
	}

	/**
	 * Flush any pending logs
	 */
	public async flush(): Promise<void> {
		if (this._logger) {
			try {
				await this._logger.flush();
			} catch (_error) {
				// Ignore flush errors as they're usually due to logger being closed
				// This can happen in test environments or during shutdown
			}
		}
	}

	/**
	 * Flush logs synchronously (for signal handlers)
	 */
	public flushSync(): void {
		if (this._logger) {
			this._logger.flushSync();
		}
	}

	/**
	 * End the logger and close all streams
	 */
	public async end(): Promise<void> {
		if (this._logger) {
			await this._logger.end();
			this._logger = null;
			this._config = null;
			// Don't reset dependency flags - they can be reused for new loggers
		}
	}
}

// Export the singleton instance for easy access
export const loggerProvider = LoggerProvider.getInstance();
