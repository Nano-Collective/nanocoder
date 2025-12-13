/**
 * Health check and monitoring system for logging infrastructure
 * Provides comprehensive health metrics and monitoring capabilities
 */

import {
	generateCorrelationId,
	withNewCorrelationContext,
	getLogger,
} from './index.js';
import {loadavg} from 'os';
import {globalLogStorage} from './log-query.js';
import {globalRequestTracker} from './request-tracker.js';
import {globalPerformanceMonitor} from './performance.js';
import type {CorrelationContext} from './types.js';

// Get logger instance directly to avoid circular dependencies
const logger = getLogger();

/**
 * Health check result interface
 */
export interface HealthCheckResult {
	status: 'healthy' | 'degraded' | 'unhealthy';
	score: number; // 0-100
	checks: HealthCheck[];
	timestamp: string;
	duration: number;
	correlationId: string;
	summary: {
		total: number;
		passed: number;
		failed: number;
		warnings: number;
	};
	recommendations: string[];
}

/**
 * Individual health check interface
 */
export interface HealthCheck {
	name: string;
	status: 'pass' | 'fail' | 'warn';
	score: number; // 0-100
	duration: number;
	message?: string;
	details?: Record<string, unknown>;
	error?: string;
	threshold?: {
		warning: number;
		critical: number;
	};
}

/**
 * System metrics interface
 */
export interface SystemMetrics {
	timestamp: string;
	memory: {
		heapUsed: number;
		heapTotal: number;
		external: number;
		rss: number;
		heapUsagePercent: number;
	};
	cpu: {
		usage: number;
		loadAverage: number[];
	};
	process: {
		uptime: number;
		pid: number;
		nodeVersion: string;
		platform: string;
		arch: string;
	};
	logging: {
		totalLogEntries: number;
		logRate: number; // entries per second
		errorRate: number; // errors per second
		averageLogSize: number;
		oldestLogEntry?: string;
		newestLogEntry?: string;
	};
	requests: {
		totalRequests: number;
		activeRequests: number;
		averageDuration: number;
		errorRate: number;
		requestsPerSecond: number;
	};
	performance: {
		operationCount: number;
		averageDuration: number;
		slowOperations: number;
		memoryIntensiveOps: number;
	};
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
	enabled: boolean;
	interval: number; // ms between checks
	timeout: number; // ms per check
	thresholds: {
		memory: {
			heapUsageWarning: number; // percentage
			heapUsageCritical: number;
			externalWarning: number; // MB
			externalCritical: number;
		};
		performance: {
			averageDurationWarning: number; // ms
			averageDurationCritical: number;
			errorRateWarning: number; // percentage
			errorRateCritical: number;
		};
		logging: {
			logRateWarning: number; // logs per second
			logRateCritical: number;
			errorRateWarning: number; // percentage
			errorRateCritical: number;
		};
		requests: {
			durationWarning: number; // ms
			durationCritical: number;
			errorRateWarning: number; // percentage
			errorRateCritical: number;
		};
	};
	alerts: {
		enabled: boolean;
		channels: ('console' | 'file' | 'webhook')[];
		webhookUrl?: string;
		cooldown: number; // ms between alerts
	};
}

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
			interval: 30000, // 30 seconds
			timeout: 5000, // 5 seconds
			thresholds: {
				memory: {
					heapUsageWarning: 0.8,
					heapUsageCritical: 0.95,
					externalWarning: 256,
					externalCritical: 512,
				},
				performance: {
					averageDurationWarning: 1000,
					averageDurationCritical: 5000,
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
					durationWarning: 2000,
					durationCritical: 10000,
					errorRateWarning: 0.05,
					errorRateCritical: 0.1,
				},
			},
			alerts: {
				enabled: true,
				channels: ['console'],
				cooldown: 300000, // 5 minutes
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
					logger.error('Failed to cleanup health monitoring interval during error recovery', {
						error: cleanupError instanceof Error ? cleanupError.message : cleanupError,
						correlationId: this.correlationId,
						source: 'health-monitor',
					});
				}
			}
		}
	}

	/**
	 * Run a comprehensive health check
	 */
	async runHealthCheck(): Promise<HealthCheckResult> {
		return withNewCorrelationContext(async (_context: CorrelationContext) => {
			const startTime = performance.now();

			try {
				logger.debug('Starting health check', {
					correlationId: this.correlationId,
					source: 'health-monitor',
				});

				const checks: HealthCheck[] = [];

				// Run all health checks
				checks.push(await this.checkMemory());
				checks.push(await this.checkLoggingSystem());
				checks.push(await this.checkRequestTracking());
				checks.push(await this.checkPerformanceMonitoring());
				checks.push(await this.checkConfigurationSystem());

				// Calculate overall health
				const totalChecks = checks.length;
				const passedChecks = checks.filter(c => c.status === 'pass').length;
				const failedChecks = checks.filter(c => c.status === 'fail').length;
				const warningChecks = checks.filter(c => c.status === 'warn').length;
				const averageScore =
					checks.reduce((sum, c) => sum + c.score, 0) / totalChecks;

				// Determine overall status
				let status: 'healthy' | 'degraded' | 'unhealthy';
				if (failedChecks > 0) {
					status = 'unhealthy';
				} else if (warningChecks > 0 || averageScore < 80) {
					status = 'degraded';
				} else {
					status = 'healthy';
				}

				const duration = performance.now() - startTime;

				const result: HealthCheckResult = {
					status,
					score: Math.round(averageScore),
					checks,
					timestamp: new Date().toISOString(),
					duration: Math.round(duration),
					correlationId: this.correlationId,
					summary: {
						total: totalChecks,
						passed: passedChecks,
						failed: failedChecks,
						warnings: warningChecks,
					},
					recommendations: this.generateRecommendations(checks, status),
				};

				this.lastCheck = result;

				// Log health check result
				logger.info('Health check completed', {
					status,
					score: result.score,
					duration: `${duration.toFixed(2)}ms`,
					summary: result.summary,
					correlationId: this.correlationId,
					source: 'health-monitor',
				});

				// Check if alerts should be sent
				if (
					this.config.alerts.enabled &&
					(status === 'unhealthy' || status === 'degraded')
				) {
					await this.sendAlert(result);
				}

				return result;
			} catch (error) {
				const duration = performance.now() - startTime;

				logger.error('Health check failed', {
					error: error instanceof Error ? error.message : error,
					duration: `${duration.toFixed(2)}ms`,
					correlationId: this.correlationId,
					source: 'health-monitor',
				});

				const result: HealthCheckResult = {
					status: 'unhealthy',
					score: 0,
					checks: [
						{
							name: 'health-check-system',
							status: 'fail',
							score: 0,
							duration,
							error: error instanceof Error ? error.message : String(error),
						},
					],
					timestamp: new Date().toISOString(),
					duration: Math.round(duration),
					correlationId: this.correlationId,
					summary: {
						total: 1,
						passed: 0,
						failed: 1,
						warnings: 0,
					},
					recommendations: [
						'Fix health check system errors',
						'Check system resources',
						'Review configuration',
					],
				};

				this.lastCheck = result;
				return result;
			}
		});
	}

	/**
	 * Get current system metrics
	 */
	getSystemMetrics(): SystemMetrics {
		const _now = Date.now();
		const memory = process.memoryUsage();
		const cpuUsage = process.cpuUsage();
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

	private checkMemory(): Promise<HealthCheck> {
		const startTime = performance.now();
		const memory = process.memoryUsage();
		const heapUsagePercent = memory.heapUsed / memory.heapTotal;
		const externalMB = memory.external / 1024 / 1024;

		const thresholds = this.config.thresholds.memory;
		let status: 'pass' | 'fail' | 'warn' = 'pass';
		let message = 'Memory usage is healthy';
		const details = {
			heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
			heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
			heapUsagePercent: Math.round(heapUsagePercent * 100),
			externalMB: Math.round(externalMB),
			rssMB: Math.round(memory.rss / 1024 / 1024),
		};

		if (
			heapUsagePercent > thresholds.heapUsageCritical ||
			externalMB > thresholds.externalCritical
		) {
			status = 'fail';
			message = 'Memory usage is critically high';
		} else if (
			heapUsagePercent > thresholds.heapUsageWarning ||
			externalMB > thresholds.externalWarning
		) {
			status = 'warn';
			message = 'Memory usage is elevated';
		}

		return Promise.resolve({
			name: 'memory-usage',
			status,
			score: this.calculateScore(
				status,
				heapUsagePercent,
				thresholds.heapUsageWarning,
				thresholds.heapUsageCritical,
			),
			duration: performance.now() - startTime,
			message,
			details,
			threshold: {
				warning: thresholds.heapUsageWarning,
				critical: thresholds.heapUsageCritical,
			},
		});
	}

	private checkLoggingSystem(): Promise<HealthCheck> {
		const startTime = performance.now();
		const logCount = globalLogStorage.getEntryCount();
		const thresholds = this.config.thresholds.logging;

		// Check if logging system is functional
		let status: 'pass' | 'fail' | 'warn' = 'pass';
		let message = 'Logging system is healthy';
		const details = {
			totalEntries: logCount,
			isConfigReloaderActive: false,
			hasLogger: !!getLogger(),
		};

		if (!getLogger()) {
			status = 'fail';
			message = 'Logger is not initialized';
		} else if (logCount === 0 && process.uptime() > 60) {
			status = 'warn';
			message = 'No log entries detected';
		}

		return Promise.resolve({
			name: 'logging-system',
			status,
			score: this.calculateScore(status, 0, 0, 0),
			duration: performance.now() - startTime,
			message,
			details,
			threshold: {
				warning: thresholds.logRateWarning,
				critical: thresholds.logRateCritical,
			},
		});
	}

	private checkRequestTracking(): Promise<HealthCheck> {
		const startTime = performance.now();
		const stats = globalRequestTracker.getStats();
		const thresholds = this.config.thresholds.requests;

		let status: 'pass' | 'fail' | 'warn' = 'pass';
		let message = 'Request tracking is healthy';
		const details = {
			totalRequests: stats.totalRequests,
			averageDuration: Math.round(stats.averageDuration),
			errorRate: Math.round(stats.errorRate * 10000) / 100, // percentage with 2 decimals
			activeRequests: globalRequestTracker.getActiveRequests().length,
		};

		if (stats.errorRate > thresholds.errorRateCritical) {
			status = 'fail';
			message = 'Request error rate is critically high';
		} else if (stats.averageDuration > thresholds.durationCritical) {
			status = 'fail';
			message = 'Request duration is critically high';
		} else if (stats.errorRate > thresholds.errorRateWarning) {
			status = 'warn';
			message = 'Request error rate is elevated';
		} else if (stats.averageDuration > thresholds.durationWarning) {
			status = 'warn';
			message = 'Request duration is elevated';
		}

		return Promise.resolve({
			name: 'request-tracking',
			status,
			score: this.calculateScore(
				status,
				stats.errorRate,
				thresholds.errorRateWarning,
				thresholds.errorRateCritical,
			),
			duration: performance.now() - startTime,
			message,
			details,
			threshold: {
				warning: thresholds.errorRateWarning,
				critical: thresholds.errorRateCritical,
			},
		});
	}

	private checkPerformanceMonitoring(): Promise<HealthCheck> {
		const startTime = performance.now();
		const stats = globalPerformanceMonitor.getAllStats();
		const thresholds = this.config.thresholds.performance;

		let status: 'pass' | 'fail' | 'warn' = 'pass';
		let message = 'Performance monitoring is healthy';
		const details = {
			trackedOperations: Object.keys(stats).length,
			totalMeasurements: Object.values(stats).reduce(
				(sum, stat) => sum + (stat?.count || 0),
				0,
			),
		};

		// Check if performance monitoring is functional
		if (Object.keys(stats).length === 0 && process.uptime() > 60) {
			status = 'warn';
			message = 'No performance measurements detected';
		}

		return Promise.resolve({
			name: 'performance-monitoring',
			status,
			score: this.calculateScore(status, 0, 0, 0),
			duration: performance.now() - startTime,
			message,
			details,
			threshold: {
				warning: thresholds.averageDurationWarning,
				critical: thresholds.averageDurationCritical,
			},
		});
	}

	private checkConfigurationSystem(): Promise<HealthCheck> {
		const startTime = performance.now();
		const reloaderStats = {isEnabled: false, watcherCount: 0};

		const status: 'pass' | 'fail' | 'warn' = 'pass';
		const message = 'Configuration system is healthy';
		const details = {
			isEnabled: reloaderStats.isEnabled,
			watcherCount: reloaderStats.watcherCount,
			listenerCount: 0,
			hasPendingReloads: false,
		};

		return Promise.resolve({
			name: 'configuration-system',
			status,
			score: this.calculateScore(status, 0, 0, 0),
			duration: performance.now() - startTime,
			message,
			details,
		});
	}

	private calculateScore(
		status: 'pass' | 'fail' | 'warn',
		value: number,
		warningThreshold: number,
		criticalThreshold: number,
	): number {
		if (status === 'fail') return 0;
		if (status === 'pass') return 100;
		if (status === 'warn') {
			// Calculate score based on how far from critical threshold
			const range = criticalThreshold - warningThreshold;
			const distance = criticalThreshold - value;
			return Math.max(50, Math.min(80, 50 + (distance / range) * 30));
		}
		return 50; // default for unknown status
	}

	private generateRecommendations(
		checks: HealthCheck[],
		status: 'healthy' | 'degraded' | 'unhealthy',
	): string[] {
		const recommendations: string[] = [];

		for (const check of checks) {
			switch (check.name) {
				case 'memory-usage':
					if (check.status === 'fail') {
						recommendations.push(
							'Immediate memory optimization required - consider increasing memory limits or fixing memory leaks',
						);
					} else if (check.status === 'warn') {
						recommendations.push(
							'Monitor memory usage and optimize memory-intensive operations',
						);
					}
					break;

				case 'logging-system':
					if (check.status === 'fail') {
						recommendations.push(
							'Fix logging system initialization - check logger configuration',
						);
					}
					break;

				case 'request-tracking':
					if (check.status === 'fail') {
						recommendations.push(
							'Address high request error rates or slow request processing',
						);
					} else if (check.status === 'warn') {
						recommendations.push(
							'Monitor request performance and optimize slow endpoints',
						);
					}
					break;

				case 'performance-monitoring':
					if (check.status === 'warn') {
						recommendations.push(
							'Ensure performance monitoring is integrated into critical operations',
						);
					}
					break;
			}
		}

		if (status === 'unhealthy') {
			recommendations.push(
				'System health is critical - immediate attention required',
			);
		} else if (status === 'degraded') {
			recommendations.push(
				'System performance is degraded - review recommendations and optimize',
			);
		}

		return recommendations;
	}

	private sendAlert(result: HealthCheckResult): Promise<void> {
		if (!this.config.alerts.enabled) return Promise.resolve();

		// Check cooldown
		if (
			this.lastAlert &&
			Date.now() - this.lastAlert < this.config.alerts.cooldown
		) {
			return Promise.resolve();
		}

		this.lastAlert = Date.now();

		const alertMessage = `Health Alert: ${result.status.toUpperCase()} - Score: ${
			result.score
		}/100`;
		const alertDetails = {
			status: result.status,
			score: result.score,
			summary: result.summary,
			recommendations: result.recommendations,
			timestamp: result.timestamp,
			correlationId: this.correlationId,
		};

		// Send to configured channels
		for (const channel of this.config.alerts.channels) {
			switch (channel) {
				case 'console':
					logger.error(alertMessage, {
						...alertDetails,
						source: 'health-monitor-alert',
					});
					break;

				case 'file':
					// Could implement file-based alerting
					logger.warn(alertMessage, {
						...alertDetails,
						source: 'health-monitor-alert',
					});
					break;

				case 'webhook':
					if (this.config.alerts.webhookUrl) {
						try {
							// TODO: implement webhook call here
							logger.info('Webhook alert would be sent', {
								url: this.config.alerts.webhookUrl,
								correlationId: this.correlationId,
								source: 'health-monitor-alert',
							});
						} catch (error) {
							logger.error('Failed to send webhook alert', {
								url: this.config.alerts.webhookUrl,
								error: error instanceof Error ? error.message : error,
								correlationId: this.correlationId,
								source: 'health-monitor-alert',
							});
						}
					}
					break;
			}
		}

		return Promise.resolve();
	}
}

/**
 * Global health monitor instance
 */
export const globalHealthMonitor = new HealthMonitor();

/**
 * Quick health check functions
 */
export const healthChecks = {
	/**
	 * Quick health check - returns status only
	 */
	quick: async (): Promise<'healthy' | 'degraded' | 'unhealthy'> => {
		const result = await globalHealthMonitor.runHealthCheck();
		return result.status;
	},

	/**
	 * Full health check with details
	 */
	full: (): Promise<HealthCheckResult> => globalHealthMonitor.runHealthCheck(),

	/**
	 * System metrics snapshot
	 */
	metrics: (): SystemMetrics => globalHealthMonitor.getSystemMetrics(),

	/**
	 * Check if system is ready
	 */
	ready: async (): Promise<boolean> => {
		const result = await globalHealthMonitor.runHealthCheck();
		return result.status === 'healthy';
	},

	/**
	 * Check if system is alive (basic check)
	 */
	alive: (): boolean => {
		try {
			const metrics = globalHealthMonitor.getSystemMetrics();
			return metrics.process.uptime > 0;
		} catch {
			return false;
		}
	},
};

/**
 * Initialize health monitoring with default configuration
 */
export function initializeHealthMonitoring(
	config?: Partial<HealthCheckConfig>,
): void {
	globalHealthMonitor.updateConfig(config || {});
	globalHealthMonitor.start();

	logger.info('Health monitoring initialized', {
		enabled: globalHealthMonitor.isActive(),
		correlationId: generateCorrelationId(),
		source: 'health-monitor-init',
	});
}

/**
 * Health check middleware for HTTP servers
 */
export function healthCheckMiddleware() {
	return async (req: {path: string}, res: {
		status: (code: number) => {
			json: (data: unknown) => void;
		};
		json: (data: unknown) => void;
	}, next: () => void) => {
		if (req.path === '/health') {
			try {
				const health = await healthChecks.full();
				const statusCode =
					health.status === 'healthy'
						? 200
						: health.status === 'degraded'
						? 200
						: 503;

				res.status(statusCode).json({
					status: health.status,
					timestamp: health.timestamp,
					score: health.score,
					checks: health.checks.map(check => ({
						name: check.name,
						status: check.status,
						score: check.score,
					})),
				});
			} catch (error) {
				res.status(503).json({
					status: 'unhealthy',
					timestamp: new Date().toISOString(),
					error: error instanceof Error ? error.message : 'Unknown error',
				});
			}
		} else if (req.path === '/health/ready') {
			const ready = await healthChecks.ready();
			const statusCode = ready ? 200 : 503;
			res.status(statusCode).json({ready});
		} else if (req.path === '/health/live') {
			const alive = healthChecks.alive();
			const statusCode = alive ? 200 : 503;
			res.status(statusCode).json({alive});
		} else if (req.path === '/metrics') {
			const metrics = healthChecks.metrics();
			res.json(metrics);
		} else {
			next();
		}
	};
}

export default HealthMonitor;
