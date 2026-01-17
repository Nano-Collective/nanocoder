/**
 * Logger Provider - Implements dependency injection pattern for logging
 * This file provides centralized logger management without circular dependencies
 */

import {createLogMethods} from './log-method-factory.js';
import type {Logger, LoggerConfig, LogLevel} from './types.js';

export class LoggerProvider {
	private static instance: LoggerProvider | null = null;
	private _logger: Logger | null = null;
	private _config: LoggerConfig | null = null;
	private _fallbackInitialized = false;
	private _realDependenciesLoaded = false;

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
	 * Initialize lazy-loaded dependencies to avoid circular imports
	 */
	private ensureDependenciesLoaded() {
		if (this._fallbackInitialized) {
			return;
		}

		// For now, use fallback logger synchronously to avoid circular dependencies
		// The real Pino logger will be loaded asynchronously when needed
		this._createPinoLogger = () => this.createFallbackLogger();
		this._createConfig = (config?: Partial<LoggerConfig>) =>
			this.createFallbackConfig(config);
		this._fallbackInitialized = true;

		// Skip loading real Pino dependencies if running under Bun
		// Bun's worker threads are incompatible with Pino's transport API (pino/file)
		// which uses thread-stream and real-require packages
		if (LoggerProvider.isBunRuntime()) {
			if (process.env.NODE_ENV === 'development') {
				// Use console directly since this._config is not yet set,
				// so createFallbackLogger() would default to 'silent' level
				console.info(
					'[LOGGER_PROVIDER] Bun runtime detected - using fallback logger (Pino transport incompatible)',
				);
			}
			return;
		}

		// Asynchronously load the real dependencies and replace the fallback
		this.loadRealDependencies().catch(error => {
			try {
				const fallbackLogger = this.createFallbackLogger();
				fallbackLogger.error(
					'[LOGGER_PROVIDER] Failed to load real dependencies',
					{
						error: this.formatErrorForLogging(error),
						fallback: true,
						source: 'logger-provider',
						timestamp: new Date().toISOString(),
					},
				);
			} catch (fallbackError) {
				// Absolute fallback to console if everything else fails
				console.error(
					'[LOGGER_PROVIDER] Critical failure - fallback logger failed:',
					fallbackError,
					'Original error:',
					error,
				);
			}
		});
	}

	/**
	 * Asynchronously load real Pino dependencies
	 * Uses dynamic imports to avoid circular dependency issues
	 */
	private async loadRealDependencies() {
		// Skip if already loaded to prevent duplicate loading
		if (this._realDependenciesLoaded) {
			// Only log in development mode to avoid noise for end users
			if (process.env.NODE_ENV === 'development') {
				this.createFallbackLogger().debug('Real dependencies already loaded', {
					source: 'logger-provider',
					status: 'already-loaded',
				});
			}
			return;
		}

		const startTime = Date.now();
		// Only log in development mode to avoid noise for end users
		if (process.env.NODE_ENV === 'development') {
			this.createFallbackLogger().info('Loading real Pino dependencies', {
				source: 'logger-provider',
				method: 'dynamic-import',
				status: 'starting',
			});
		}

		try {
			// Load dependencies dynamically to avoid circular imports
			// Using Promise.all for parallel loading to improve performance
			const [pinoLogger, configModule] = await Promise.all([
				import('./pino-logger.js'),
				import('./config.js'),
			]);

			// Verify imports were successful
			if (!pinoLogger?.createPinoLogger || !configModule?.createConfig) {
				throw new Error('Dynamic imports returned invalid modules');
			}

			this._createPinoLogger = pinoLogger.createPinoLogger;
			this._createConfig = configModule.createConfig;
			this._realDependenciesLoaded = true;

			// Don't reinitialize existing logger to avoid breaking ongoing operations
			// The real Pino logger will be used for new logger instances created after this point

			// Only log in development mode
			if (process.env.NODE_ENV === 'development') {
				this.createFallbackLogger().info(
					'Real dependencies loaded successfully',
					{
						source: 'logger-provider',
						status: 'success',
						duration: Date.now() - startTime,
						modules: ['pino-logger', 'config'],
					},
				);
			}
		} catch (error) {
			try {
				const fallbackLogger = this.createFallbackLogger();
				fallbackLogger.error(
					'[LOGGER_PROVIDER] Failed to load real dependencies',
					{
						error: this.formatErrorForLogging(error),
						fallback: true,
						source: 'logger-provider',
						status: 'load-failed',
						duration: Date.now() - startTime,
					},
				);
			} catch (fallbackError) {
				// Absolute fallback to console if everything else fails
				console.error(
					'[LOGGER_PROVIDER] Critical failure - fallback logger failed:',
					fallbackError,
					'Original error:',
					error,
				);
			}
			// Keep the fallback logger
		}
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
		const envLevel = process.env.NANOCODER_LOG_LEVEL as LogLevel;
		if (envLevel) return envLevel;

		const isTest = process.env.NODE_ENV === 'test';
		const isDev = process.env.NODE_ENV === 'development';

		if (isTest) return 'silent';
		if (isDev) return 'debug';
		// Production fallback logger: silent (outputs to console, not file)
		// The real pino logger will use 'info' once loaded
		return 'silent';
	}

	/**
	 * Create fallback config when config.ts hasn't loaded yet
	 * Uses getDefaultLogLevel() for consistent defaults
	 */
	private createFallbackConfig(
		override: Partial<LoggerConfig> = {},
	): LoggerConfig {
		const isDev = process.env.NODE_ENV === 'development';
		const isTest = process.env.NODE_ENV === 'test';

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

		const fallbackConsole = console; // Use console as the logger

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
	 * Format error for structured logging
	 */
	private formatErrorForLogging(error: unknown): object {
		if (error instanceof Error) {
			return {
				message: error.message,
				stack: error.stack,
				name: error.name,
				cause: error.cause,
			};
		}
		return {value: error};
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
		this._realDependenciesLoaded = false;
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
