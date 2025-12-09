import React from 'react';
import ErrorMessage from '@/components/error-message';
import InfoMessage from '@/components/info-message';
import SuccessMessage from '@/components/success-message';
import WarningMessage from '@/components/warning-message';
import type {MessageType} from '@/types/index';
// Import logging utilities with dependency injection pattern
import {
	withNewCorrelationContext,
	generateCorrelationId,
	getCorrelationId,
	startMetrics,
	endMetrics,
	calculateMemoryDelta,
	formatMemoryUsage,
} from '@/utils/logging';
import {createErrorInfo} from '@/utils/error-formatter';

// Global message queue function - will be set by App component
let globalAddToChatQueue: ((component: React.ReactNode) => void) | null = null;
let componentKeyCounter = 0;

// Get logger instance to avoid circular dependencies
import {getLogger} from '@/utils/logging';
const logger = getLogger();

// Set the global chat queue function
export function setGlobalMessageQueue(
	addToChatQueue: (component: React.ReactNode) => void,
) {
	logger.info('Global message queue initialized', {
		hasPreviousQueue: !!globalAddToChatQueue,
	});
	globalAddToChatQueue = addToChatQueue;
}

// Helper function to generate stable keys
function getNextKey(): string {
	componentKeyCounter++;
	return `global-msg-${componentKeyCounter}`;
}

// Enhanced message metadata for tracking and debugging
export interface MessageMetadata {
	id: string;
	type: MessageType;
	timestamp: string;
	correlationId?: string;
	duration?: number;
	source?: string;
	context?: Record<string, any>;
	performanceMetrics?: {
		duration: number;
		memoryDelta: number;
	};
}

// Message queue statistics for monitoring
export interface MessageQueueStats {
	totalMessages: number;
	messagesByType: Record<MessageType, number>;
	averageRenderTime: number;
	lastMessageTime: string;
	errorsLogged: number;
}

// Global message statistics
let messageStats: MessageQueueStats = {
	totalMessages: 0,
	messagesByType: {
		info: 0,
		success: 0,
		warning: 0,
		error: 0,
	},
	averageRenderTime: 0,
	lastMessageTime: '',
	errorsLogged: 0,
};

// Add a React component directly to the queue
export function addToMessageQueue(component: React.ReactNode) {
	if (!globalAddToChatQueue) {
		console.log('[message-queue] Queue not available, component not added');
		return;
	}
	globalAddToChatQueue(component);
}

// Add typed message to chat queue (internal helper) with enhanced logging and metadata
function addTypedMessage(
	type: MessageType,
	message: string,
	hideBox: boolean = true,
	options?: {
		correlationId?: string;
		source?: string;
		context?: Record<string, any>;
		error?: unknown;
	},
) {
	const correlationId = options?.correlationId || generateCorrelationId();
	const metrics = startMetrics();
	const timestamp = new Date().toISOString();

	return withNewCorrelationContext(() => {
		// Log the message to structured logging system
		logger[
			type === 'error'
				? 'error'
				: type === 'warning'
				? 'warn'
				: type === 'success'
				? 'info'
				: 'info'
		](`Message queued: ${type.toUpperCase()}`, {
			messageType: type,
			message: message.substring(0, 200), // Truncate long messages for logs
			hideBox,
			source: options?.source || 'unknown',
			context: options?.context,
			correlationId,
			hasGlobalQueue: !!globalAddToChatQueue,
			messageId: `msg-${componentKeyCounter + 1}`,
		});

		// Log error details if provided
		if (options?.error && type === 'error') {
			const errorInfo = createErrorInfo(
				options.error,
				options.context,
				correlationId,
			);
			logger.error('Message queue error details', {
				errorInfo,
				correlationId,
			});
		}

		// Update statistics
		messageStats.totalMessages++;
		messageStats.messagesByType[type]++;
		messageStats.lastMessageTime = timestamp;
		if (type === 'error') {
			messageStats.errorsLogged++;
		}

		// Fallback to structured logging if queue not available
		if (!globalAddToChatQueue) {
			logger.warn(
				'Message queue not available, using structured logging fallback',
				{
					messageType: type,
					message: message.substring(0, 100),
					correlationId,
				},
			);

			// Use structured logging instead of console
			if (type === 'error') {
				logger.error(message, {
					correlationId,
					source: 'message-queue-fallback',
				});
			} else if (type === 'warning') {
				logger.warn(message, {correlationId, source: 'message-queue-fallback'});
			} else {
				logger.info(message, {correlationId, source: 'message-queue-fallback'});
			}
			return;
		}

		const key = getNextKey();
		let component: React.ReactNode;

		switch (type) {
			case 'error':
				component = (
					<ErrorMessage
						key={key}
						message={message}
						hideBox={hideBox}
											/>
				);
				break;
			case 'success':
				component = (
					<SuccessMessage
						key={key}
						message={message}
						hideBox={hideBox}
											/>
				);
				break;
			case 'warning':
				component = (
					<WarningMessage
						key={key}
						message={message}
						hideBox={hideBox}
											/>
				);
				break;
			case 'info':
			default:
				component = (
					<InfoMessage
						key={key}
						message={message}
						hideBox={hideBox}
					/>
				);
				break;
		}

		// Track performance metrics
		const finalMetrics = endMetrics(metrics);
		const memoryDelta = calculateMemoryDelta(
			metrics.memoryUsage!,
			finalMetrics.memoryUsage!,
		);

		logger.debug('Message component created', {
			messageType: type,
			componentKey: key,
			renderTime: `${finalMetrics.duration.toFixed(2)}ms`,
			memoryDelta: formatMemoryUsage(memoryDelta as unknown as NodeJS.MemoryUsage),
			correlationId,
		});

		// Add to global queue
		globalAddToChatQueue(component);
	}, correlationId);
}

// Enhanced convenience functions with additional context
export function logInfo(
	message: string,
	hideBox: boolean = true,
	options?: {
		source?: string;
		context?: Record<string, any>;
		correlationId?: string;
	},
) {
	addMessageToQueue('info', message, hideBox, {
		...options,
		source: options?.source || 'logInfo',
	});
}

export function logError(
	message: string,
	hideBox: boolean = true,
	options?: {
		source?: string;
		context?: Record<string, any>;
		correlationId?: string;
		error?: unknown;
	},
) {
	addMessageToQueue('error', message, hideBox, {
		...options,
		source: options?.source || 'logError',
	});
}

export function logSuccess(
	message: string,
	hideBox: boolean = true,
	options?: {
		source?: string;
		context?: Record<string, any>;
		correlationId?: string;
	},
) {
	addMessageToQueue('success', message, hideBox, {
		...options,
		source: options?.source || 'logSuccess',
	});
}

export function logWarning(
	message: string,
	hideBox: boolean = true,
	options?: {
		source?: string;
		context?: Record<string, any>;
		correlationId?: string;
	},
) {
	addMessageToQueue('warning', message, hideBox, {
		...options,
		source: options?.source || 'logWarning',
	});
}

// Specialized logging functions for common scenarios
export function logApiCall(
	method: string,
	url: string,
	statusCode: number,
	duration: number,
	options?: {
		requestSize?: number;
		responseSize?: number;
		correlationId?: string;
	},
) {
	const correlationId = options?.correlationId || generateCorrelationId();

	withNewCorrelationContext(() => {
		if (statusCode >= 400) {
			logError(`API ${method} ${url} failed (${statusCode})`, false, {
				source: 'api-call',
				correlationId,
				context: {
					method,
					url,
					statusCode,
					duration: `${duration}ms`,
					requestSize: options?.requestSize,
					responseSize: options?.responseSize,
				},
			});
		} else {
			logInfo(`API ${method} ${url} completed (${statusCode})`, true, {
				source: 'api-call',
				correlationId,
				context: {
					method,
					url,
					statusCode,
					duration: `${duration}ms`,
					requestSize: options?.requestSize,
					responseSize: options?.responseSize,
				},
			});
		}
	}, correlationId);
}

export function logToolExecution(
	toolName: string,
	status: 'started' | 'completed' | 'failed',
	duration?: number,
	options?: {
		correlationId?: string;
		error?: unknown;
		context?: Record<string, any>;
	},
) {
	const correlationId = options?.correlationId || generateCorrelationId();
	const context = {
		toolName,
		status,
		duration: duration ? `${duration}ms` : undefined,
		...options?.context,
	};

	switch (status) {
		case 'started':
			logInfo(`Tool execution started: ${toolName}`, true, {
				source: 'tool-execution',
				correlationId,
				context,
			});
			break;
		case 'completed':
			logSuccess(`Tool execution completed: ${toolName}`, true, {
				source: 'tool-execution',
				correlationId,
				context,
			});
			break;
		case 'failed':
			logError(`Tool execution failed: ${toolName}`, false, {
				source: 'tool-execution',
				correlationId,
				context,
				error: options?.error,
			});
			break;
	}
}

export function logUserAction(
	action: string,
	details?: Record<string, any>,
	options?: {
		correlationId?: string;
	},
) {
	logInfo(`User action: ${action}`, true, {
		source: 'user-action',
		correlationId: options?.correlationId,
		context: {
			action,
			...details,
		},
	});
}

// Convenience functions for each message type
export function logInfo(message: string, hideBox: boolean = true) {
	addTypedMessage('info', message, hideBox);
// Get current message queue statistics
export function getMessageQueueStats(): MessageQueueStats {
	return {...messageStats};
}

// Reset message queue statistics
export function resetMessageQueueStats() {
	messageStats = {
		totalMessages: 0,
		messagesByType: {
			info: 0,
			success: 0,
			warning: 0,
			error: 0,
		},
		averageRenderTime: 0,
		lastMessageTime: '',
		errorsLogged: 0,
	};

	logger.info('Message queue statistics reset', {
		correlationId: generateCorrelationId(),
	});
}

export function logError(message: string, hideBox: boolean = true) {
	addTypedMessage('error', message, hideBox);
}

// Temporarily ingored in `knip.json`. We do want this. We just haven't used it yet.
export function logSuccess(message: string, hideBox: boolean = true) {
	addTypedMessage('success', message, hideBox);
}

export function logWarning(message: string, hideBox: boolean = true) {
	addTypedMessage('warning', message, hideBox);
// Log current message queue statistics
export function logMessageQueueStats() {
	logger.info('Message queue statistics', {
		stats: messageStats,
		correlationId: generateCorrelationId(),
	});
}

// Enhanced message queue health check
export function checkMessageQueueHealth(): {
	isHealthy: boolean;
	issues: string[];
	stats: MessageQueueStats;
} {
	const issues: string[] = [];

	// Check if queue is initialized
	if (!globalAddToChatQueue) {
		issues.push('Global message queue not initialized');
	}

	// Check error rate
	const errorRate =
		messageStats.totalMessages > 0
			? (messageStats.errorsLogged / messageStats.totalMessages) * 100
			: 0;

	if (errorRate > 20) {
		// More than 20% errors is concerning
		issues.push(`High error rate: ${errorRate.toFixed(1)}%`);
	}

	// Check if messages are being processed
	if (messageStats.lastMessageTime) {
		const lastMessageAge =
			Date.now() - new Date(messageStats.lastMessageTime).getTime();
		const fiveMinutes = 5 * 60 * 1000;

		if (lastMessageAge > fiveMinutes && messageStats.totalMessages > 0) {
			issues.push(
				`No messages for ${Math.round(lastMessageAge / 60000)} minutes`,
			);
		}
	}

	const isHealthy = issues.length === 0;

	logger.debug('Message queue health check', {
		isHealthy,
		issues,
		stats: messageStats,
		correlationId: generateCorrelationId(),
	});

	return {
		isHealthy,
		issues,
		stats: messageStats,
	};
}
