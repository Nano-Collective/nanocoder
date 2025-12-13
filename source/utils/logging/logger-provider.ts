/**
 * Logger Provider - Implements dependency injection pattern for logging
 * This file provides centralized logger management without circular dependencies
 */

import type {Logger, LoggerConfig, LogLevel} from './types.js';
import {createLogMethods} from './log-method-factory.js';

export class LoggerProvider {
	private static instance: LoggerProvider | null = null;
	private _logger: Logger | null = null;
	private _config: LoggerConfig | null = null;
	private _dependenciesLoaded = false;

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
		if (this._dependenciesLoaded) {
			return;
		}

		// For now, use fallback logger synchronously to avoid circular dependencies
		// The real Pino logger will be loaded asynchronously when needed
		this._createPinoLogger = () => this.createFallbackLogger();
		this._createConfig = (config?: Partial<LoggerConfig>) => ({
			level: 'info',
			pretty: false,
			redact: [],
			correlation: false,
			serialize: false,
			...config,
		});
		this._dependenciesLoaded = true;

		// Asynchronously load the real dependencies and replace the fallback
		this.loadRealDependencies().catch(error => {
			try {
				const fallbackLogger = this.createFallbackLogger();
				fallbackLogger.error('[LOGGER_PROVIDER] Failed to load real dependencies', {
					error: this.formatErrorForLogging(error),
					fallback: true,
					source: 'logger-provider',
					timestamp: new Date().toISOString()
				});
			} catch (fallbackError) {
				// Absolute fallback to console if everything else fails
				console.error('[LOGGER_PROVIDER] Critical failure - fallback logger failed:', 
							fallbackError, 'Original error:', error);
			}
		});
	}

	/**
	 * Asynchronously load real Pino dependencies
	 * Uses dynamic imports to avoid circular dependency issues
	 */
	private async loadRealDependencies() {
		// Skip if already loaded to prevent duplicate loading
		if (this._dependenciesLoaded) {
			this.createFallbackLogger().debug('Real dependencies already loaded', {
				source: 'logger-provider',
				status: 'already-loaded'
			});
			return;
		}

		const startTime = Date.now();
		this.createFallbackLogger().info('Loading real Pino dependencies', {
			source: 'logger-provider',
			method: 'dynamic-import',
			status: 'starting'
		});

		try {
			// Load dependencies dynamically to avoid circular imports
			// Using Promise.all for parallel loading to improve performance
			const [pinoLogger, configModule] = await Promise.all([
				import('./pino-logger.js'),
				import('./config.js')
			]);

			// Verify imports were successful
			if (!pinoLogger?.createPinoLogger || !configModule?.createConfig) {
				throw new Error('Dynamic imports returned invalid modules');
			}

			this._createPinoLogger = pinoLogger.createPinoLogger;
			this._createConfig = configModule.createConfig;
			this._dependenciesLoaded = true;

			// If we already have a logger with fallback config, reinitialize it with real config
			if (this._logger && this._config) {
				try {
					this._logger = this._createPinoLogger(this._config);
					this.createFallbackLogger().info('Logger reinitialized with real Pino instance', {
						source: 'logger-provider',
						status: 'reinitialized',
						duration: Date.now() - startTime
					});
				} catch (reinitError) {
					this.createFallbackLogger().warn('Failed to reinitialize logger, keeping fallback', {
						error: this.formatErrorForLogging(reinitError),
						source: 'logger-provider',
						status: 'reinit-failed'
					});
				}
			}

			this.createFallbackLogger().info('Real dependencies loaded successfully', {
				source: 'logger-provider',
				status: 'success',
				duration: Date.now() - startTime,
				modules: ['pino-logger', 'config']
			});

		} catch (error) {
			try {
				const fallbackLogger = this.createFallbackLogger();
				fallbackLogger.error('[LOGGER_PROVIDER] Failed to load real dependencies', {
					error: this.formatErrorForLogging(error),
					fallback: true,
					source: 'logger-provider',
					status: 'load-failed',
					duration: Date.now() - startTime
				});
			} catch (fallbackError) {
				// Absolute fallback to console if everything else fails
				console.error('[LOGGER_PROVIDER] Critical failure - fallback logger failed:', 
							fallbackError, 'Original error:', error);
			}
			// Keep the fallback logger
		}
	}

	/**
	 * Create fallback logger when dependencies fail to load
	 */
	private createFallbackLogger(): Logger {
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
			child: (_bindings: Record<string, unknown>) => this.createFallbackLogger(),
			isLevelEnabled: (_level: string) => true,
			flush: async () => Promise.resolve(),
			end: async () => Promise.resolve(),
		};
	}

	/**
	 * Create default configuration based on environment
	 */
	private createDefaultConfig(
		override: Partial<LoggerConfig> = {},
	): LoggerConfig {
		const isDev = process.env.NODE_ENV === 'development';
		const isTest = process.env.NODE_ENV === 'test';

		const defaultConfig: LoggerConfig = {
			level: isTest
				? 'silent'
				: isDev
				? 'debug'
				: (process.env.NANOCODER_LOG_LEVEL as LogLevel) || 'info',
			pretty: isDev,
			redact: ['apiKey', 'token', 'password', 'secret'],
			correlation: true,
			serialize: !isDev,
		};

		return {...defaultConfig, ...override};
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
		this._logger = this._createPinoLogger?.(this._config) ?? this.createFallbackLogger();

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
				cause: error.cause
			};
		}
		return { value: error };
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
		this._dependenciesLoaded = false;
		this._createPinoLogger = null;
		this._createConfig = null;
	}

	/**
	 * Flush any pending logs
	 */
	public async flush(): Promise<void> {
		if (this._logger) {
			await this._logger.flush();
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
		}
	}
}

// Export the singleton instance for easy access
export const loggerProvider = LoggerProvider.getInstance();
