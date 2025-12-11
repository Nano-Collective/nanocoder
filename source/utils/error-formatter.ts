/**
 * Enhanced error formatting utilities with structured logging integration
 * Handles Error instances and unknown error types consistently
 *
 * This utility provides comprehensive error analysis and formatting
 * with integration to the structured logging system for better debugging.
 */

// Import logging utilities with dependency injection pattern
import {
	generateCorrelationId,
	withNewCorrelationContext,
	getLogger,
} from '@/utils/logging';
import type {Logger} from '@/utils/logging';

// Get logger instance to avoid circular dependencies
const logger = getLogger();

/**
 * Enhanced error information with structured metadata
 */
export interface ErrorInfo {
	message: string;
	name?: string;
	stack?: string;
	code?: string | number;
	type: 'Error' | 'String' | 'Object' | 'Unknown';
	originalType: string;
	hasStack: boolean;
	isNetworkError: boolean;
	isTimeoutError: boolean;
	isValidationError: boolean;
	timestamp: string;
	correlationId?: string;
	cause?: unknown;
	context?: Record<string, any>;
}

/**
 * Format error objects into string messages
 * Handles Error instances and unknown error types consistently
 *
 * This utility eliminates the repeated pattern of:
 * ```
 * error instanceof Error ? error.message : String(error)
 * ```
 *
 * @param error - Error of any type (Error instance, string, object, etc.)
 * @param context - Additional context information for logging
 * @returns Formatted error message string
 *
 * @example
 * try {
 *   await doSomething();
 * } catch (error) {
 *   const message = formatError(error);
 *   console.error(message);
 * }
 */
export function formatError(
	error: unknown,
	context?: Record<string, any>,
): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

/**
 * Create comprehensive error information with logging
 *
 * @param error - Error of any type
 * @param context - Additional context information
 * @param correlationId - Optional correlation ID for tracking
 * @returns Enhanced error information object
 */
export function createErrorInfo(
	error: unknown,
	context?: Record<string, any>,
	correlationId?: string,
): ErrorInfo {
	const timestamp = new Date().toISOString();
	const effectiveCorrelationId = correlationId || generateCorrelationId();

	// Determine error type and extract information
	if (error instanceof Error) {
		const errorInfo: ErrorInfo = {
			message: error.message,
			name: error.name,
			stack: error.stack,
			type: 'Error',
			originalType: error.constructor.name,
			hasStack: !!error.stack,
			isNetworkError: isNetworkError(error),
			isTimeoutError: isTimeoutError(error),
			isValidationError: isValidationError(error),
			timestamp,
			correlationId: effectiveCorrelationId,
			context,
		};

		// Extract cause if available
		if (error.cause) {
			errorInfo.cause = error.cause;
		}

		// Extract error code if available
		const errorCode = extractErrorCode(error);
		if (errorCode) {
			errorInfo.code = errorCode;
		}

		return errorInfo;
	}

	// Handle non-Error objects
	const errorType = typeof error;
	const message = String(error);

	return {
		message,
		type:
			errorType === 'string'
				? 'String'
				: errorType === 'object' && error !== null
				? 'Object'
				: 'Unknown',
		originalType: errorType,
		hasStack: false,
		isNetworkError: false,
		isTimeoutError: false,
		isValidationError: false,
		timestamp,
		correlationId: effectiveCorrelationId,
		context,
	};
}

/**
 * Log error with structured information and correlation
 *
 * @param error - Error of any type
 * @param context - Additional context information
 * @param level - Log level to use (default: 'error')
 * @returns Formatted error message
 */
export function logError(
	error: unknown,
	context?: Record<string, any>,
	level: 'error' | 'warn' | 'fatal' = 'error',
): string {
	const errorInfo = createErrorInfo(error, context);

	return withNewCorrelationContext(() => {
		// Log the structured error information
		logger[level]('Error occurred', {
			error: {
				name: errorInfo.name,
				message: errorInfo.message,
				type: errorInfo.type,
				originalType: errorInfo.originalType,
				code: errorInfo.code,
				hasStack: errorInfo.hasStack,
				isNetworkError: errorInfo.isNetworkError,
				isTimeoutError: errorInfo.isTimeoutError,
				isValidationError: errorInfo.isValidationError,
			},
			context: errorInfo.context,
			correlationId: errorInfo.correlationId,
			timestamp: errorInfo.timestamp,
		});

		// Log stack trace if available and in development mode
		if (errorInfo.stack && process.env.NODE_ENV === 'development') {
			logger.debug('Error stack trace', {
				stack: errorInfo.stack,
				correlationId: errorInfo.correlationId,
			});
		}

		// Log cause if available
		if (errorInfo.cause) {
			logger.warn('Error cause information', {
				cause: errorInfo.cause,
				correlationId: errorInfo.correlationId,
			});
		}

		return errorInfo.message;
	}, errorInfo.correlationId);
}

/**
 * Format error with enhanced information for UI display
 *
 * @param error - Error of any type
 * @param includeStack - Whether to include stack trace (default: false)
 * @param context - Additional context information
 * @returns Formatted error message with optional details
 */
export function formatErrorForDisplay(
	error: unknown,
	includeStack: boolean = false,
	context?: Record<string, any>,
): string {
	const errorInfo = createErrorInfo(error, context);

	let message = errorInfo.message;

	// Add error type prefix if it's a standard Error
	if (errorInfo.name && errorInfo.name !== 'Error') {
		message = `${errorInfo.name}: ${message}`;
	}

	// Add specific error indicators
	if (errorInfo.isNetworkError) {
		message = `🌐 Network Error: ${message}`;
	} else if (errorInfo.isTimeoutError) {
		message = `⏱️ Timeout Error: ${message}`;
	} else if (errorInfo.isValidationError) {
		message = `⚠️ Validation Error: ${message}`;
	}

	// Add correlation ID for tracking
	if (errorInfo.correlationId) {
		message += ` (ID: ${errorInfo.correlationId})`;
	}

	// Add stack trace in development mode or if requested
	if (includeStack && errorInfo.stack) {
		message += `\n\nStack trace:\n${errorInfo.stack}`;
	}

	return message;
}

/**
 * Create a user-friendly error message from technical errors
 *
 * @param error - Error of any type
 * @param context - Additional context information
 * @returns User-friendly error message
 */
export function createUserFriendlyMessage(
	error: unknown,
	context?: Record<string, any>,
): string {
	const errorInfo = createErrorInfo(error, context);

	// Network errors
	if (errorInfo.isNetworkError) {
		return 'Network connection issue. Please check your internet connection and try again.';
	}

	// Timeout errors
	if (errorInfo.isTimeoutError) {
		return 'Operation timed out. Please try again.';
	}

	// Validation errors
	if (errorInfo.isValidationError) {
		return `Invalid input: ${errorInfo.message}`;
	}

	// API errors with codes
	if (errorInfo.code) {
		switch (errorInfo.code) {
			case 401:
			case '401':
				return 'Authentication failed. Please check your credentials.';
			case 403:
			case '403':
				return "Access denied. You don't have permission to perform this action.";
			case 404:
			case '404':
				return 'Resource not found.';
			case 429:
			case '429':
				return 'Too many requests. Please wait and try again.';
			case 500:
			case '500':
				return 'Server error. Please try again later.';
			default:
				return errorInfo.message;
		}
	}

	// Generic fallback with user-friendly message
	if (errorInfo.message.length > 100) {
		return errorInfo.message.substring(0, 97) + '...';
	}

	return errorInfo.message;
}

/**
 * Check if error is a network-related error
 */
function isNetworkError(error: Error): boolean {
	return (
		error.name === 'NetworkError' ||
		error.name === 'FetchError' ||
		error.name === 'ECONNREFUSED' ||
		error.name === 'ENOTFOUND' ||
		error.name === 'ECONNRESET' ||
		error.name === 'ETIMEDOUT' ||
		error.message.includes('network') ||
		error.message.includes('fetch') ||
		error.message.includes('connection')
	);
}

/**
 * Check if error is a timeout error
 */
function isTimeoutError(error: Error): boolean {
	return (
		error.name === 'TimeoutError' ||
		error.name === 'ETIMEDOUT' ||
		error.message.includes('timeout') ||
		error.message.includes('timed out')
	);
}

/**
 * Check if error is a validation error
 */
function isValidationError(error: Error): boolean {
	return (
		error.name === 'ValidationError' ||
		error.name === 'ZodError' ||
		error.message.includes('validation') ||
		error.message.includes('invalid') ||
		error.message.includes('required')
	);
}

/**
 * Extract error code from error object
 */
function extractErrorCode(error: Error): string | number | undefined {
	// Try common properties for error codes
	if ('status' in error) {
		return (error as any).status;
	}
	if ('statusCode' in error) {
		return (error as any).statusCode;
	}
	if ('code' in error) {
		return (error as any).code;
	}
	if ('errorCode' in error) {
		return (error as any).errorCode;
	}

	return undefined;
}

/**
 * Error recovery suggestions based on error type
 */
export function getErrorRecoverySuggestions(error: unknown): string[] {
	const errorInfo = createErrorInfo(error);
	const suggestions: string[] = [];

	if (errorInfo.isNetworkError) {
		suggestions.push('Check your internet connection');
		suggestions.push('Verify the server is accessible');
		suggestions.push('Try again in a few moments');
	}

	if (errorInfo.isTimeoutError) {
		suggestions.push('Try again with a longer timeout');
		suggestions.push('Check if the operation is still running');
		suggestions.push('Break down the operation into smaller parts');
	}

	if (errorInfo.isValidationError) {
		suggestions.push('Check your input format');
		suggestions.push('Verify all required fields are provided');
		suggestions.push('Review the documentation for correct format');
	}

	if (errorInfo.code === 401 || errorInfo.code === '401') {
		suggestions.push('Check your API key or credentials');
		suggestions.push('Verify your authentication method');
		suggestions.push('Refresh your access token');
	}

	if (errorInfo.code === 429 || errorInfo.code === '429') {
		suggestions.push('Wait before making another request');
		suggestions.push('Check rate limit documentation');
		suggestions.push('Implement exponential backoff');
	}

	// Default suggestions
	if (suggestions.length === 0) {
		suggestions.push('Try the operation again');
		suggestions.push('Check the error logs for more details');
		suggestions.push('Contact support if the issue persists');
	}

	return suggestions;
}

// Export the original formatError function for backward compatibility
export {formatError as formatErrorLegacy};
