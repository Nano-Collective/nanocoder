/**
 * Logger Provider - Implements dependency injection pattern for logging
 * This file provides centralized logger management without circular dependencies
 */

import type {Logger, LoggerConfig, LogLevel} from './types.js';
import {createLogMethod} from './log-method-factory.js';

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
			console.error(
				'[LOGGER_PROVIDER] Failed to load real dependencies, using fallback:',
				error,
			);
		});
	}

	/**
	 * Asynchronously load real Pino dependencies
	 */
	private async loadRealDependencies() {
		try {
			// Load dependencies dynamically to avoid circular imports
			const pinoLogger = await import('./pino-logger.js');
			const configModule = await import('./config.js');

			this._createPinoLogger = pinoLogger.createPinoLogger;
			this._createConfig = configModule.createConfig;

			// If we already have a logger with fallback config, reinitialize it with real config
			if (this._logger && this._config) {
				this._logger = this._createPinoLogger(this._config);
			}
		} catch (error) {
			console.error(
				'[LOGGER_PROVIDER] Failed to load real dependencies:',
				error,
			);
			// Keep the fallback logger
		}
	}

	/**
	 * Create fallback logger when dependencies fail to load
	 */
	private createFallbackLogger(): Logger {
		const fallbackConsole = console; // Use console as the logger

		return {
			fatal: createLogMethod(fallbackConsole, 'fatal', {
				consolePrefix: 'FATAL',
				consoleMethod: 'error',
			}) as any,
			error: createLogMethod(fallbackConsole, 'error', {
				consolePrefix: 'ERROR',
				consoleMethod: 'error',
			}) as any,
			warn: createLogMethod(fallbackConsole, 'warn', {
				consolePrefix: 'WARN',
				consoleMethod: 'warn',
			}) as any,
			info: createLogMethod(fallbackConsole, 'info', {
				consolePrefix: 'INFO',
				consoleMethod: 'log',
			}) as any,
			http: createLogMethod(fallbackConsole, 'http', {
				consolePrefix: 'HTTP',
				consoleMethod: 'log',
			}) as any,
			debug: createLogMethod(fallbackConsole, 'debug', {
				consolePrefix: 'DEBUG',
				consoleMethod: 'log',
			}) as any,
			trace: createLogMethod(fallbackConsole, 'trace', {
				consolePrefix: 'TRACE',
				consoleMethod: 'log',
			}) as any,
			child: (_bindings: Record<string, any>) => this.createFallbackLogger(),
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
				: (process.env.LOG_LEVEL as LogLevel) || 'info',
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
		this._logger = this._createPinoLogger!(this._config);

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
	public createChildLogger(bindings: Record<string, any>): Logger {
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
