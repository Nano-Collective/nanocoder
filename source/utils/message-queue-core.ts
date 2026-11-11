/**
 * React-free core of the global message queue.
 *
 * Non-UI modules (config loaders, services, CLI fast paths) import the
 * `log*` helpers from here so that loading them never pulls in Ink: the
 * `nanocoder config`/`daemon`/`skills` fast paths would otherwise load the
 * whole TUI stack just to be able to log. The Ink components that render a
 * queued message are supplied by `@/utils/message-queue`, which is what the
 * App uses to attach its chat queue. Until that happens every message goes
 * to the structured logger only, exactly as before.
 */
import type {ReactNode} from 'react';
import {generateKey} from '@/session/key-generator';
import type {MessageType} from '@/types/index';
import {createErrorInfo} from '@/utils/error-formatter';
// Import logging utilities with dependency injection pattern
import {
	generateCorrelationId,
	withNewCorrelationContext,
} from '@/utils/logging';
import {
	calculateMemoryDelta,
	endMetrics,
	formatMemoryUsage,
	startMetrics,
} from '@/utils/logging/performance.js';

// Global message queue function - will be set by App component
let globalAddToChatQueue: ((component: ReactNode) => void) | null = null;

/** Builds the chat component for one typed message. */
export type MessageRenderer = (
	type: MessageType,
	message: string,
	hideBox: boolean,
	key: string,
) => ReactNode;

let globalMessageRenderer: MessageRenderer | null = null;

export type MessageQueueSink = (
	type: MessageType,
	message: string,
	options?: {
		correlationId?: string;
		source?: string;
		context?: Record<string, unknown>;
		error?: unknown;
		hideBox?: boolean;
	},
) => void;

let globalMessageQueueSink: MessageQueueSink | null = null;

export function setMessageQueueSink(sink: MessageQueueSink | null): void {
	globalMessageQueueSink = sink;
}

// Get logger instance to avoid circular dependencies
import {getLogger} from '@/utils/logging';

const logger = getLogger();

// Set the global chat queue function and the renderer that builds the
// components it receives. UI code calls the one-argument wrapper in
// `@/utils/message-queue`, which supplies the Ink renderer.
export function setGlobalMessageQueueWithRenderer(
	addToChatQueue: (component: ReactNode) => void,
	renderer: MessageRenderer,
) {
	logger.info('Global message queue initialized', {
		hasPreviousQueue: !!globalAddToChatQueue,
	});
	globalAddToChatQueue = addToChatQueue;
	globalMessageRenderer = renderer;
}

// Add a React component directly to the queue
export function addToMessageQueue(component: ReactNode) {
	if (!globalAddToChatQueue) {
		logger.warn('[message-queue] Queue not available, component not added');
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
		context?: Record<string, unknown>;
		error?: unknown;
	},
) {
	const correlationId = options?.correlationId || generateCorrelationId();
	const metrics = startMetrics();

	return withNewCorrelationContext(() => {
		// Log the message to structured logging system
		logger[type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'info'](
			`Message queued: ${type.toUpperCase()}`,
			{
				messageType: type,
				message: message.substring(0, 200), // Truncate long messages for logs
				hideBox,
				source: options?.source || 'unknown',
				context: options?.context,
				correlationId,
				hasGlobalQueue: !!globalAddToChatQueue,
			},
		);

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

		if (globalMessageQueueSink) {
			try {
				globalMessageQueueSink(type, message, {
					correlationId,
					source: options?.source,
					context: options?.context,
					error: options?.error,
					hideBox,
				});
			} catch (err) {
				logger.error('Error in message queue sink', {err});
			}
		}

		// Fallback to structured logging if queue not available
		if (!globalAddToChatQueue || !globalMessageRenderer) {
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

		const key = generateKey('global-msg');
		const component = globalMessageRenderer(type, message, hideBox, key);

		// Track performance metrics
		const finalMetrics = endMetrics(metrics);
		const memoryDelta = calculateMemoryDelta(
			// biome-ignore lint/style/noNonNullAssertion: memoryUsage is always defined after endMetrics
			metrics.memoryUsage!,
			// biome-ignore lint/style/noNonNullAssertion: memoryUsage is always defined after endMetrics
			finalMetrics.memoryUsage!,
		);

		logger.debug('Message component created', {
			messageType: type,
			componentKey: key,
			renderTime: `${finalMetrics.duration.toFixed(2)}ms`,
			memoryDelta: formatMemoryUsage(
				memoryDelta as unknown as NodeJS.MemoryUsage,
			),
			correlationId,
		});

		// Add to global queue
		globalAddToChatQueue(component);
	}, correlationId);
}

// Enhanced convenience functions with additional context
interface LogOptions {
	source?: string;
	// biome-ignore lint/suspicious/noExplicitAny: Dynamic format args
	context?: Record<string, any>;
	correlationId?: string;
	error?: unknown;
}

/**
 * Build a typed `log<Level>` convenience function. The default `source` is the
 * function's own name so log lines stay attributable when callers omit it.
 */
function makeLogFn(type: MessageType, defaultSource: string) {
	return (message: string, hideBox: boolean = true, options?: LogOptions) => {
		addTypedMessage(type, message, hideBox, {
			...options,
			source: options?.source || defaultSource,
		});
	};
}

export const logInfo = makeLogFn('info', 'logInfo');
export const logError = makeLogFn('error', 'logError');
export const logWarning = makeLogFn('warning', 'logWarning');
