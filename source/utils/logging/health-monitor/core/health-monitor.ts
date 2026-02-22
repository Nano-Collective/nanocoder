/**
 * Main health monitoring class
 */

import nodeProcess from 'node:process';
import {loadavg} from 'os';
import {
	COOLDOWN_ALERT_MS,
	DURATION_AVERAGE_CRITICAL_MS,
	DURATION_AVERAGE_WARNING_MS,
	DURATION_REQUEST_CRITICAL_MS,
	DURATION_REQUEST_WARNING_MS,
	HEAP_USAGE_CRITICAL_THRESHOLD,
	HEAP_USAGE_WARNING_THRESHOLD,
	INTERVAL_HEALTH_CHECK_MS,
	TIMEOUT_HEALTH_CHECK_MS,
} from '@/constants';
import {generateCorrelationId} from '../../correlation.js';
import {globalLogStorage} from '../../log-query/index.js';
import {loggerProvider} from '../../logger-provider.js';
import {globalPerformanceMonitor} from '../../performance.js';
import {globalRequestTracker} from '../../request-tracker.js';

const getLogger = () => loggerProvider.getLogger();

import {sendAlert} from '../alerts/alert-manager.js';
import type {
	HealthCheckConfig,
	HealthCheckResult,
	SystemMetrics,
} from '../types.js';
import {runHealthCheck} from './health-check-runner.js';

// Get logger instance directly to avoid circular dependencies
const logger = getLogger();

/**
 * Safe memory usage getter with runtime checks
 */
const getSafeMemory = (): NodeJS.MemoryUsage => {
	try {
		if (nodeProcess && typeof nodeProcess.memoryUsage === 'function') {
			return nodeProcess.memoryUsage();
		}
	} catch {
		// Ignore any errors during process.memoryUsage()
	}
	return {rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0};
};

/**
 * Safe CPU usage getter with runtime checks
 */
const getSafeCpuUsage = (): NodeJS.CpuUsage => {
	try {
		if (nodeProcess && typeof nodeProcess.cpuUsage === 'function') {
			return nodeProcess.cpuUsage();
		}
	} catch {
		// Ignore any errors during process.cpuUsage()
	}
	return {user: 0, system: 0};
};

/**
 * Health monitoring system
 */
export class HealthMonitor {
	private config: HealthCheckConfig;
	private isRunning: boolean = false;
	private intervalId?: NodeJS.Timeout;
	private lastCheck?: HealthCheckResult;
	private lastAlert?: number;
	private correlationId: string;

	constructor(config?: Partial<HealthCheckConfig>) {
		this.correlationId = generateCorrelationId();
		this.config = {
			enabled: true,
			interval: INTERVAL_HEALTH_CHECK_MS,
			timeout: TIMEOUT_HEALTH_CHECK_MS,
			thresholds: {
				memory: {
					heapUsageWarning: HEAP_USAGE_WARNING_THRESHOLD,
					heapUsageCritical: HEAP_USAGE_CRITICAL_THRESHOLD,
					externalWarning: 256,
					externalCritical: 512,
				},
				performance: {
					averageDurationWarning: DURATION_AVERAGE_WARNING_MS,
					averageDurationCritical: DURATION_AVERAGE_CRITICAL_MS,
					errorRateWarning: 0.05,
					errorRateCritical: 0.1,
				},
				logging: {
					logRateWarning: 100,
					logRateCritical: 500,
					errorRateWarning: 0.02,
					errorRateCritical: 0.05,
				},
				requests: {
					durationWarning: DURATION_REQUEST_WARNING_MS,
					durationCritical: DURATION_REQUEST_CRITICAL_MS,
					errorRateWarning: 0.05,
					errorRateCritical: 0.1,
				},
			},
			alerts: {
				enabled: true,
				channels: ['console'],
				cooldown: COOLDOWN_ALERT_MS,
			},
			...config,
		};
	}

	/**
	 * Start health monitoring
	 */
	start(): void {
		try {
			if (this.isRunning) {
				logger.warn('Health monitoring already running', {
					correlationId: this.correlationId,
					source: 'health-monitor',
				});
				return;
			}

			this.isRunning = true;

			// Run initial check
			try {
				void this.runHealthCheck();
			} catch (error) {
				logger.error('Failed to run initial health check', {
					error: error instanceof Error ? error.message : error,
					correlationId: this.correlationId,
					source: 'health-monitor',
				});
				// Continue starting monitoring even if initial check fails
			}

			// Schedule regular checks
			try {
				this.intervalId = setInterval(() => {
					try {
						void this.runHealthCheck();
					} catch (error) {
						logger.error('Failed to run scheduled health check', {
							error: error instanceof Error ? error.message : error,
							correlationId: this.correlationId,
							source: 'health-monitor',
						});
					}
				}, this.config.interval);
			} catch (error) {
				logger.error('Failed to schedule health monitoring', {
					error: error instanceof Error ? error.message : error,
					correlationId: this.correlationId,
					source: 'health-monitor',
				});
				this.isRunning = false;
				return;
			}

			logger.info('Health monitoring started', {
				interval: `${this.config.interval}ms`,
				timeout: `${this.config.timeout}ms`,
				correlationId: this.correlationId,
				source: 'health-monitor',
			});
		} catch (error) {
			logger.error('Critical error starting health monitoring', {
				error: error instanceof Error ? error.message : error,
				correlationId: this.correlationId,
				source: 'health-monitor',
			});
			this.isRunning = false;
		}
	}

	/**
	 * Stop health monitoring
	 */
	stop(): void {
		try {
			if (!this.isRunning) {
				logger.debug('Health monitoring not running', {
					correlationId: this.correlationId,
					source: 'health-monitor',
				});
				return;
			}

			this.isRunning = false;

			try {
				if (this.intervalId) {
					clearInterval(this.intervalId);
					this.intervalId = undefined;
				}
			} catch (error) {
				logger.error('Failed to clear health monitoring interval', {
					error: error instanceof Error ? error.message : error,
					correlationId: this.correlationId,
					source: 'health-monitor',
				});
				// Continue with cleanup even if interval clearing fails
			}

			logger.info('Health monitoring stopped', {
				correlationId: this.correlationId,
				source: 'health-monitor',
			});
		} catch (error) {
			logger.error('Critical error stopping health monitoring', {
				error: error instanceof Error ? error.message : error,
				correlationId: this.correlationId,
				source: 'health-monitor',
			});
			// Ensure we don't leave the system in a bad state
			this.isRunning = false;
			if (this.intervalId) {
				try {
					clearInterval(this.intervalId);
					this.intervalId = undefined;
				} catch (cleanupError) {
					// Final fallback - log but don't rethrow
					logger.error(
						'Failed to cleanup health monitoring interval during error recovery',
						{
							error:
								cleanupError instanceof Error
									? cleanupError.message
									: cleanupError,
							correlationId: this.correlationId,
							source: 'health-monitor',
						},
					);
				}
			}
		}
	}

	/**
	 * Run a comprehensive health check
	 */
	async runHealthCheck(): Promise<HealthCheckResult> {
		const result = await runHealthCheck(this.config, this.correlationId);
		this.lastCheck = result;

		// Check if alerts should be sent
		if (
			this.config.alerts.enabled &&
			(result.status === 'unhealthy' || result.status === 'degraded')
		) {
			await sendAlert(result, this.config, this.lastAlert, this.correlationId);
			this.lastAlert = Date.now();
		}

		return result;
	}

	/**
	 * Get current system metrics
	 */
	getSystemMetrics(): SystemMetrics {
		const _now = Date.now();
		const memory = getSafeMemory();
		const cpuUsage = getSafeCpuUsage();
		const requestStats = globalRequestTracker.getStats();
		const logStats = globalLogStorage.getEntryCount();
		const perfStats = globalPerformanceMonitor.getAllStats();

		// Calculate rates (approximate based on current state)
		const logRate = logStats / (process.uptime() / 60); // logs per minute
		const errorRate = requestStats.errorRate;
		const requestsPerSecond = requestStats.totalRequests / process.uptime();

		// Calculate average operation duration from performance stats
		const allPerfStats = Object.values(perfStats).filter(Boolean);
		const averageDuration =
			allPerfStats.length > 0
				? allPerfStats.reduce(
						(sum, stat) => sum + (stat?.avgDuration || 0),
						0,
					) / allPerfStats.length
				: 0;

		return {
			timestamp: new Date().toISOString(),
			memory: {
				heapUsed: memory.heapUsed,
				heapTotal: memory.heapTotal,
				external: memory.external,
				rss: memory.rss,
				heapUsagePercent: memory.heapUsed / memory.heapTotal,
			},
			cpu: {
				usage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to milliseconds
				loadAverage: loadavg(),
			},
			process: {
				uptime: process.uptime(),
				pid: process.pid,
				nodeVersion: process.version,
				platform: process.platform,
				arch: process.arch,
			},
			logging: {
				totalLogEntries: logStats,
				logRate,
				errorRate,
				averageLogSize: 256, // Estimated
			},
			requests: {
				totalRequests: requestStats.totalRequests,
				activeRequests: globalRequestTracker.getActiveRequests().length,
				averageDuration: requestStats.averageDuration,
				errorRate: requestStats.errorRate,
				requestsPerSecond,
			},
			performance: {
				operationCount: allPerfStats.reduce(
					(sum, stat) => sum + (stat?.count || 0),
					0,
				),
				averageDuration,
				slowOperations: 0, // Would need tracking over time
				memoryIntensiveOps: 0, // Would need tracking over time
			},
		};
	}

	/**
	 * Get last health check result
	 */
	getLastHealthCheck(): HealthCheckResult | undefined {
		return this.lastCheck;
	}

	/**
	 * Check if monitoring is running
	 */
	isActive(): boolean {
		return this.isRunning;
	}

	/**
	 * Update health check configuration
	 */
	updateConfig(config: Partial<HealthCheckConfig>): void {
		this.config = {...this.config, ...config};

		logger.info('Health monitor configuration updated', {
			enabled: this.config.enabled,
			interval: `${this.config.interval}ms`,
			correlationId: this.correlationId,
			source: 'health-monitor',
		});

		// Restart monitoring if running
		if (this.isRunning) {
			this.stop();
			this.start();
		}
	}
}

/**
 * Global health monitor instance
 */
export const globalHealthMonitor = new HealthMonitor();
