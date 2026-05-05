import {RetryError} from 'ai';

function unwrapError(error: unknown, seen: Set<unknown>): unknown {
	if (error === null || error === undefined) {
		return error;
	}

	if (typeof error !== 'object' && typeof error !== 'function') {
		return error;
	}

	if (seen.has(error)) {
		return error;
	}
	seen.add(error);

	// Handle AI SDK RetryError - extract the last error
	if (RetryError.isInstance(error) && error.lastError) {
		return unwrapError(error.lastError, seen);
	}

	// AI SDK v6 often wraps transport/API failures in Error.cause
	// (for example AI_NoOutputGeneratedError -> APICallError). Unwrap
	// that chain so callers can surface the real provider error instead
	// of treating it like a blank model response.
	if (error instanceof Error && error.cause) {
		return unwrapError(error.cause, seen);
	}

	return error;
}

/**
 * Extracts the root cause error from AI SDK error wrappers.
 */
export function extractRootError(error: unknown): unknown {
	return unwrapError(error, new Set());
}
