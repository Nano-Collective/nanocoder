/**
 * Enhanced error formatting utilities with structured logging integration
 * Handles Error instances and unknown error types consistently
 *
 * This utility provides comprehensive error analysis and formatting
 * with integration to the structured logging system for better debugging.
 */

// Import logging utilities with dependency injection pattern
import {generateCorrelationId} from '@/utils/logging';

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
	context?: Record<string, unknown>;
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
export function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	const stringified = String(error);
	// String() on a plain object returns "[object Object]", which is useless
	// to surface to the user. Fall back to JSON so the real shape is visible.
	if (stringified === '[object Object]') {
		try {
			return JSON.stringify(error);
		} catch {
			return stringified;
		}
	}
	return stringified;
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
	context?: Record<string, unknown>,
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
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic error type
		return (error as any).status;
	}
	if ('statusCode' in error) {
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic error type
		return (error as any).statusCode;
	}
	if ('code' in error) {
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic error type
		return (error as any).code;
	}
	if ('errorCode' in error) {
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic error type
		return (error as any).errorCode;
	}

	return undefined;
}
