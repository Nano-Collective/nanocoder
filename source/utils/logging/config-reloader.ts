/**
 * Hot-reloading configuration manager for logging
 * Allows dynamic configuration changes without application restart
 */

import {readFile} from 'fs/promises';
import {watchFile, unwatchFile, Stats} from 'fs';
import {resolve} from 'path';
import {
	generateCorrelationId,
	withNewCorrelationContext,
} from './index.js';
import type {LoggerConfig} from './types.js';

// Lazy logger initialization to avoid circular dependency
let _logger: any = null;
function getLogger() {
	if (!_logger) {
		const { getLogger: _getLogger } = require('./index.js');
		_logger = _getLogger();
	}
	return _logger;
}

// Create a logger proxy that maintains the same API
const logger = new Proxy({} as any, {
	get(target, prop) {
		const loggerInstance = getLogger();
		return loggerInstance[prop];
	}
});

/**
 * Configuration change event
 */
export interface ConfigChangeEvent {
	type:
		| 'level'
		| 'transport'
		| 'format'
		| 'redaction'
		| 'correlation'
		| 'custom';
	path: string;
	oldValue: any;
	newValue: any;
	timestamp: string;
	correlationId: string;
}

/**
 * Configuration reload result
 */
export interface ConfigReloadResult {
	success: boolean;
	changes: ConfigChangeEvent[];
	errors: string[];
	config: LoggerConfig;
	reloadTime: number;
}

/**
 * File watcher for configuration changes
 */
interface FileWatcher {
	path: string;
	watcher: ReturnType<typeof watchFile>;
	lastModified: number;
	handler: (event: string, filename: string | null) => void;
}

/**
 * Hot-reloading configuration manager
 */
export class ConfigReloader {
	private config: LoggerConfig;
	private configPath?: string;
	private fileWatchers: Map<string, FileWatcher> = new Map();
	private changeListeners: Array<(event: ConfigChangeEvent) => void> = [];
	private isEnabled: boolean = false;
	private reloadInProgress: boolean = false;
	private reloadQueue: Array<() => Promise<ConfigReloadResult>> = [];
	private correlationId: string;

	constructor(initialConfig: LoggerConfig) {
		this.config = {...initialConfig};
		this.correlationId = generateCorrelationId();
	}

	/**
	 * Enable hot-reloading
	 */
	enable(configPath?: string): void {
		if (this.isEnabled) {
			logger.warn('Config hot-reloading already enabled', {
				correlationId: this.correlationId,
				source: 'config-reloader',
			});
			return;
		}

		this.configPath = configPath;
		this.isEnabled = true;

		logger.info('Config hot-reloading enabled', {
			configPath: configPath || 'default',
			correlationId: this.correlationId,
			source: 'config-reloader',
		});

		// Start watching configuration files if path provided
		if (configPath) {
			this.watchConfigFile(configPath);
		}
	}

	/**
	 * Disable hot-reloading
	 */
	disable(): void {
		if (!this.isEnabled) {
			logger.debug('Config hot-reloading already disabled', {
				correlationId: this.correlationId,
				source: 'config-reloader',
			});
			return;
		}

		this.isEnabled = false;

		// Stop all file watchers
		for (const [path, watcher] of this.fileWatchers.entries()) {
			try {
				unwatchFile(path);
				logger.debug('Stopped watching config file', {
					path,
					correlationId: this.correlationId,
					source: 'config-reloader',
				});
			} catch (error) {
				logger.error('Failed to stop watching config file', {
					path,
					error: error instanceof Error ? error.message : error,
					correlationId: this.correlationId,
					source: 'config-reloader',
				});
			}
		}

		this.fileWatchers.clear();
		this.changeListeners = [];

		logger.info('Config hot-reloading disabled', {
			correlationId: this.correlationId,
			source: 'config-reloader',
		});
	}

	/**
	 * Add configuration change listener
	 */
	addChangeListener(listener: (event: ConfigChangeEvent) => void): void {
		this.changeListeners.push(listener);
	}

	/**
	 * Remove configuration change listener
	 */
	removeChangeListener(listener: (event: ConfigChangeEvent) => void): void {
		const index = this.changeListeners.indexOf(listener);
		if (index >= 0) {
			this.changeListeners.splice(index, 1);
		}
	}

	/**
	 * Get current configuration
	 */
	getConfig(): LoggerConfig {
		return {...this.config};
	}

	/**
	 * Update configuration (triggers change listeners)
	 */
	updateConfig(newConfig: Partial<LoggerConfig>): ConfigReloadResult {
		return withNewCorrelationContext(() => {
			const startTime = performance.now();
			const changes: ConfigChangeEvent[] = [];
			const errors: string[] = [];

			try {
				// Detect changes and validate
				const validatedConfig = this.validateAndDetectChanges(
					this.config,
					newConfig,
					changes,
					errors,
				);

				// Apply changes
				if (errors.length === 0) {
					this.config = validatedConfig;

					// Notify listeners
					for (const change of changes) {
						for (const listener of this.changeListeners) {
							try {
								listener(change);
							} catch (error) {
								logger.error('Error in config change listener', {
									change: {
										type: change.type,
										path: change.path,
										oldValue: change.oldValue,
										newValue: change.newValue,
									},
									error: error instanceof Error ? error.message : error,
									correlationId: this.correlationId,
									source: 'config-reloader',
								});
							}
						}
					}
				}

				const reloadTime = performance.now() - startTime;

				const result: ConfigReloadResult = {
					success: errors.length === 0,
					changes,
					errors,
					config: this.config,
					reloadTime,
				};

				logger.info('Configuration updated', {
					success: result.success,
					changeCount: changes.length,
					errorCount: errors.length,
					reloadTime: `${reloadTime.toFixed(2)}ms`,
					correlationId: this.correlationId,
					source: 'config-reloader',
				});

				return result;
			} catch (error) {
				const reloadTime = performance.now() - startTime;

				logger.error('Failed to update configuration', {
					error: error instanceof Error ? error.message : error,
					reloadTime: `${reloadTime.toFixed(2)}ms`,
					correlationId: this.correlationId,
					source: 'config-reloader',
				});

				return {
					success: false,
					changes: [],
					errors: [error instanceof Error ? error.message : String(error)],
					config: this.config,
					reloadTime,
				};
			}
		}, this.correlationId);
	}

	/**
	 * Reload configuration from file
	 */
	async reloadFromFile(configPath?: string): Promise<ConfigReloadResult> {
		const targetPath = configPath || this.configPath;
		if (!targetPath) {
			throw new Error('No configuration path specified');
		}

		return withNewCorrelationContext(async () => {
			try {
				logger.debug('Reloading configuration from file', {
					configPath: targetPath,
					correlationId: this.correlationId,
					source: 'config-reloader',
				});

				const configContent = await readFile(targetPath, 'utf-8');
				let newConfig: Partial<LoggerConfig>;

				try {
					// Try to parse as JSON
					newConfig = JSON.parse(configContent);
				} catch (parseError) {
					// If not JSON, try to parse as environment variables
					newConfig = this.parseEnvVars(configContent);
				}

				return this.updateConfig(newConfig);
			} catch (error) {
				logger.error('Failed to reload configuration from file', {
					configPath: targetPath,
					error: error instanceof Error ? error.message : error,
					correlationId: this.correlationId,
					source: 'config-reloader',
				});

				return {
					success: false,
					changes: [],
					errors: [error instanceof Error ? error.message : String(error)],
					config: this.config,
					reloadTime: 0,
				};
			}
		}, this.correlationId);
	}

	/**
	 * Queue a reload operation
	 */
	queueReload(reloadFn: () => Promise<ConfigReloadResult>): void {
		this.reloadQueue.push(reloadFn);

		if (!this.reloadInProgress) {
			this.processReloadQueue();
		}
	}

	/**
	 * Check if hot-reloading is enabled
	 */
	isHotReloadingEnabled(): boolean {
		return this.isEnabled;
	}

	/**
	 * Get reload statistics
	 */
	getStats(): any {
		return {
			isEnabled: this.isEnabled,
			watcherCount: this.fileWatchers.size,
			listenerCount: this.changeListeners.length,
			reloadQueueLength: this.reloadQueue.length,
			reloadInProgress: this.reloadInProgress,
			correlationId: this.correlationId,
		};
	}

	private watchConfigFile(configPath: string): void {
		const resolvedPath = resolve(configPath);

		try {
			const stats = require('fs').statSync(resolvedPath);
			const lastModified = stats.mtime.getTime();

			const watcher = watchFile(resolvedPath, (curr, prev) => {
				this.handleFileChange('change', resolvedPath, resolvedPath);
			});

			this.fileWatchers.set(resolvedPath, {
				path: resolvedPath,
				watcher,
				lastModified,
				handler: (curr, prev) =>
					this.handleFileChange('change', resolvedPath, resolvedPath),
			});

			logger.debug('Started watching config file', {
				path: resolvedPath,
				lastModified: new Date(lastModified).toISOString(),
				correlationId: this.correlationId,
				source: 'config-reloader',
			});
		} catch (error) {
			logger.error('Failed to watch config file', {
				path: resolvedPath,
				error: error instanceof Error ? error.message : error,
				correlationId: this.correlationId,
				source: 'config-reloader',
			});
		}
	}

	private handleFileChange(
		eventType: string,
		filename: string | null,
		filePath: string,
	): void {
		logger.debug('Config file changed', {
			eventType,
			filename,
			path: filePath,
			correlationId: this.correlationId,
			source: 'config-reloader',
		});

		// Debounce file changes to avoid multiple reloads
		setTimeout(() => {
			this.queueReload(() => this.reloadFromFile(filePath));
		}, 1000); // 1 second debounce
	}

	private async processReloadQueue(): Promise<void> {
		if (this.reloadQueue.length === 0) {
			return;
		}

		this.reloadInProgress = true;

		while (this.reloadQueue.length > 0) {
			const reloadFn = this.reloadQueue.shift();
			if (reloadFn) {
				try {
					await reloadFn();
				} catch (error) {
				logger.error('Error in queued reload operation', {
					error: error instanceof Error ? error.message : error,
					correlationId: this.correlationId,
					source: 'config-reloader',
				});
			}
			}
		}

		this.reloadInProgress = false;
	}

	private validateAndDetectChanges(
		currentConfig: LoggerConfig,
		newConfig: Partial<LoggerConfig>,
		changes: ConfigChangeEvent[],
		errors: string[],
	): LoggerConfig {
		const mergedConfig = {...currentConfig, ...newConfig};

		// Check for level changes
		if (newConfig.level && newConfig.level !== currentConfig.level) {
			changes.push({
				type: 'level',
				path: 'config.level',
				oldValue: currentConfig.level,
				newValue: newConfig.level,
				timestamp: new Date().toISOString(),
				correlationId: generateCorrelationId(),
			});
		}

		// Check for transport changes
		if (
			newConfig.transport &&
			JSON.stringify(newConfig.transport) !==
				JSON.stringify(currentConfig.transport)
		) {
			changes.push({
				type: 'transport',
				path: 'config.transport',
				oldValue: currentConfig.transport,
				newValue: newConfig.transport,
				timestamp: new Date().toISOString(),
				correlationId: generateCorrelationId(),
			});
		}

		// Check for format changes
		if (
			newConfig.pretty !== undefined &&
			newConfig.pretty !== currentConfig.pretty
		) {
			changes.push({
				type: 'format',
				path: 'config.pretty',
				oldValue: currentConfig.pretty,
				newValue: newConfig.pretty,
				timestamp: new Date().toISOString(),
				correlationId: generateCorrelationId(),
			});
		}

		// Check for redaction changes
		if (
			newConfig.redact &&
			JSON.stringify(newConfig.redact) !== JSON.stringify(currentConfig.redact)
		) {
			changes.push({
				type: 'redaction',
				path: 'config.redact',
				oldValue: currentConfig.redact,
				newValue: newConfig.redact,
				timestamp: new Date().toISOString(),
				correlationId: generateCorrelationId(),
			});
		}

		// Check for correlation changes
		if (
			newConfig.correlation !== undefined &&
			newConfig.correlation !== currentConfig.correlation
		) {
			changes.push({
				type: 'correlation',
				path: 'config.correlation',
				oldValue: currentConfig.correlation,
				newValue: newConfig.correlation,
				timestamp: new Date().toISOString(),
				correlationId: generateCorrelationId(),
			});
		}

		// Validate configuration
		if (!mergedConfig.level) {
			errors.push('Log level is required');
		}

		if (!this.isValidLogLevel(mergedConfig.level)) {
			errors.push(`Invalid log level: ${mergedConfig.level}`);
		}

		return mergedConfig;
	}

	private isValidLogLevel(level: string): boolean {
		const validLevels = [
			'trace',
			'debug',
			'info',
			'http',
			'warn',
			'error',
			'fatal',
			'silent',
		];
		return validLevels.includes(level);
	}

	private parseEnvVars(content: string): Partial<LoggerConfig> {
		const config: Partial<LoggerConfig> = {};
		const lines = content.split('\n');

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;

			const match = trimmed.match(/^([^=]+)=(.*)$/);
			if (match) {
				const key = match[1].trim();
				let value: string | boolean | number = match[2].trim();

				// Handle boolean values
				if (value === 'true') value = true;
				if (value === 'false') value = false;

				// Handle number values
				if (!isNaN(Number(value))) {
					value = Number(value);
				}

				// Remove quotes if present
				if (
					typeof value === 'string' &&
					((value.startsWith('"') && value.endsWith('"')) ||
						(value.startsWith("'") && value.endsWith("'")))
				) {
					value = value.slice(1, -1);
				}

				// Environment variable substitution
				if (
					typeof value === 'string' &&
					(value.includes('$') || value.includes('${'))
				) {
					value = this.substituteEnvVars(value);
				}

				(config as any)[key] = value;
			}
		}

		return config;
	}

	private substituteEnvVars(value: string): string {
		return value.replace(/\$\{([^}]+)\}|\$([^}]+)/g, (match, p1, p2) => {
			const varName = p1 || p2;
			return process.env[varName] || match;
		});
	}
}

/**
 * Global configuration reloader instance
 */
export const globalConfigReloader = new ConfigReloader({
	level: 'info',
	pretty: process.env.NODE_ENV === 'development',
	redact: ['apiKey', 'token', 'password', 'secret'],
	correlation: true,
	serialize: process.env.NODE_ENV === 'production',
});

/**
 * Initialize hot-reloading with default configuration
 */
export function initializeHotReloading(configPath?: string): void {
	if (configPath || process.env.LOG_CONFIG_PATH) {
		globalConfigReloader.enable(configPath || process.env.LOG_CONFIG_PATH);
	} else {
		// Enable without file watching - can still be updated programmatically
		globalConfigReloader.enable();
	}

	// Log initialization
	logger.info('Configuration hot-reloading initialized', {
		configPath: configPath || process.env.LOG_CONFIG_PATH || 'default',
		autoWatchEnabled: !!(configPath || process.env.LOG_CONFIG_PATH),
		correlationId: generateCorrelationId(),
		source: 'config-reloader-init',
	});
}

/**
 * Configuration change event listener for specific types
 */
export function createConfigChangeListener(
	type: ConfigChangeEvent['type'],
	handler: (event: ConfigChangeEvent) => void,
): (event: ConfigChangeEvent) => void {
	return (event: ConfigChangeEvent) => {
		if (event.type === type) {
			handler(event);
		}
	};
}

export default ConfigReloader;
