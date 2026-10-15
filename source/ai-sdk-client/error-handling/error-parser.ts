import {APICallError} from 'ai';
import {extractRootError} from './error-extractor.js';

/**
 * Last-resort serializer for errors whose .message ended up as the literal
 * string "[object Object]" because something upstream stringified an object
 * with template-literal or String() coercion. Pulls enumerable own props
 * plus known Error fields so the user sees the actual payload.
 */
function describeError(error: Error): string {
	const own: Record<string, unknown> = {};
	for (const key of Object.getOwnPropertyNames(error)) {
		if (key === 'stack') continue;
		// biome-ignore lint/suspicious/noExplicitAny: dynamic error shape
		own[key] = (error as any)[key];
	}
	try {
		const serialized = JSON.stringify(own);
		if (serialized && serialized !== '{}') return serialized;
	} catch {
		// fall through
	}
	return error.message || error.name || 'Unknown error';
}

/**
 * Optional context describing the provider a failed request was aimed at.
 * When supplied, connection and URL-configuration errors name the provider and
 * the baseUrl it tried to reach instead of blaming "the model server", so the
 * user can tell which of several providers is misconfigured.
 */
export interface ProviderErrorContext {
	/** Display name of the active provider, e.g. "MyProvider". */
	providerName?: string;
	/** The provider's configured baseUrl, e.g. "http://127.0.0.1:11434/v1". */
	baseUrl?: string;
	/** Path to the agents.config.json the provider was read from. */
	configPath?: string;
}

/** Human-readable label for the endpoint a failed request was aimed at. */
function describeProviderTarget(context?: ProviderErrorContext): string {
	if (context?.providerName && context.baseUrl) {
		return `provider "${context.providerName}" at ${context.baseUrl}`;
	}
	if (context?.providerName) {
		return `provider "${context.providerName}"`;
	}
	if (context?.baseUrl) {
		return `the model server at ${context.baseUrl}`;
	}
	return 'the model server';
}

/**
 * Points the user at the file that holds the offending baseUrl when we know
 * it, and falls back to naming the setting when we do not.
 */
function describeConfigHint(context?: ProviderErrorContext): string {
	return context?.configPath
		? `Check baseUrl in ${context.configPath}.`
		: "Check the provider's baseUrl.";
}

/**
 * Reads the Node error code (ECONNREFUSED, ERR_INVALID_URL, ...) off a root
 * error so URL-parse failures can be recognised even when the message alone is
 * ambiguous.
 */
function getErrorCode(error: Error): string | undefined {
	const code = (error as {code?: unknown}).code;
	return typeof code === 'string' ? code : undefined;
}

/**
 * Names the transport failure behind a "fetch failed" wrapper so a refused
 * connection, an unknown host, and a temporary DNS failure no longer read the
 * same. `errorMessage` is the unwrapped root cause, so the OS errno (or
 * undici's friendlier phrasing) is already in the text.
 */
function describeConnectionReason(errorMessage: string): string | undefined {
	if (errorMessage.includes('ECONNREFUSED')) {
		return 'ECONNREFUSED: connection refused';
	}
	if (errorMessage.includes('ECONNRESET')) {
		return 'ECONNRESET: connection reset by peer';
	}
	if (errorMessage.includes('ENOTFOUND')) {
		return 'ENOTFOUND: host not found (DNS lookup failed)';
	}
	if (errorMessage.includes('EAI_AGAIN')) {
		return 'EAI_AGAIN: temporary DNS failure';
	}
	if (/getaddrinfo/i.test(errorMessage)) {
		return 'DNS lookup failed';
	}
	if (/self[- ]signed|certificate/i.test(errorMessage)) {
		return 'TLS certificate error';
	}
	return undefined;
}

/**
 * Recognises the pre-connection failures a malformed baseUrl produces: a
 * `new URL()` TypeError ("Invalid URL", code ERR_INVALID_URL) and undici's
 * "bad port" / "unknown scheme", both thrown before a request leaves the
 * process. Matched on the whole message (or the error code) so ordinary API
 * errors that merely mention these phrases are not misclassified.
 */
function describeBaseUrlProblem(
	errorMessage: string,
	code: string | undefined,
): string | undefined {
	const trimmed = errorMessage.trim();
	if (code === 'ERR_INVALID_URL' || /^invalid url$/i.test(trimmed)) {
		return 'it is not a valid URL';
	}
	if (/^bad port$/i.test(trimmed)) {
		return 'it uses a port the HTTP client refuses to connect to';
	}
	if (/^unknown scheme$/i.test(trimmed)) {
		return 'it is missing a scheme (expected http:// or https://)';
	}
	return undefined;
}

/**
 * Parses API errors into user-friendly messages.
 * Exported for testing purposes.
 */
export function parseAPIError(
	error: unknown,
	context?: ProviderErrorContext,
): string {
	const result = parseAPIErrorInternal(error, context);
	// Final safety net: if our user-facing string still contains "[object Object]"
	// then some upstream Error.message was already a stringified object. Replace
	// with a structured dump so the real payload is visible.
	if (result.includes('[object Object]')) {
		const rootError = extractRootError(error);
		if (rootError instanceof Error) {
			return `Provider error: ${describeError(rootError)}`;
		}
	}
	return result;
}

function parseAPIErrorInternal(
	error: unknown,
	context?: ProviderErrorContext,
): string {
	// First extract the root error from any wrappers
	const rootError = extractRootError(error);

	if (!(rootError instanceof Error)) {
		return 'An unknown error occurred while communicating with the model';
	}

	// Handle AI SDK APICallError - it has statusCode and responseBody
	if (APICallError.isInstance(rootError)) {
		const statusCode = rootError.statusCode;
		// Try to extract a clean message from responseBody or use the error message
		let cleanMessage = rootError.message;

		// Parse the response body if available for more details
		if (rootError.responseBody) {
			try {
				const body = JSON.parse(rootError.responseBody) as {
					error?: {message?: unknown};
					message?: unknown;
				};
				const extracted = body.error?.message ?? body.message;
				if (extracted !== undefined && extracted !== null) {
					// Providers occasionally return error.message as an object/array
					// instead of a string. Coerce so we don't surface "[object Object]".
					cleanMessage =
						typeof extracted === 'string'
							? extracted
							: JSON.stringify(extracted);
				}
			} catch {
				// If not JSON, try to extract message from the raw response
				const msgMatch = rootError.responseBody.match(
					/["']?message["']?\s*[:=]\s*["']([^"']+)["']/i,
				);
				if (msgMatch) {
					cleanMessage = msgMatch[1];
				}
			}
		}

		// Format based on status code
		if (statusCode) {
			switch (statusCode) {
				case 400: {
					const url = rootError.url ? `\nURL: ${rootError.url}` : '';
					const body =
						rootError.responseBody && rootError.responseBody !== cleanMessage
							? `\nResponse body: ${rootError.responseBody}`
							: '';
					return `Bad request: ${cleanMessage}${url}${body}`;
				}
				case 401:
					return 'Authentication failed: Invalid API key or credentials';
				case 403:
					return 'Access forbidden: Check your API permissions';
				case 404:
					return 'Model not found: The requested model may not exist or is unavailable';
				case 429:
					if (
						cleanMessage.includes('usage limit') ||
						cleanMessage.includes('quota')
					) {
						return `Rate limit: ${cleanMessage}`;
					}
					return 'Rate limit exceeded: Too many requests. Please wait and try again';
				case 500:
				case 502:
				case 503:
					return `Server error: ${cleanMessage}`;
				default:
					return `Request failed (${statusCode}): ${cleanMessage}`;
			}
		}
	}

	const errorMessage = rootError.message;
	const lowerMessage = errorMessage.toLowerCase();

	// Extract status code and clean message from common error patterns FIRST
	// This ensures HTTP status codes are properly parsed before falling through
	// to more generic pattern matching (like Ollama-specific errors)
	const statusMatch = errorMessage.match(
		/(?:Error: )?(\d{3})\s+(?:\d{3}\s+)?(?:Bad Request|[^:]+):\s*(.+)/i,
	);
	if (statusMatch) {
		const [, statusCode, message] = statusMatch;
		const cleanMessage = message.trim();

		switch (statusCode) {
			case '400':
				return `Bad request: ${cleanMessage}`;
			case '401':
				return 'Authentication failed: Invalid API key or credentials';
			case '403':
				return 'Access forbidden: Check your API permissions';
			case '404':
				return 'Model not found: The requested model may not exist or is unavailable';
			case '429':
				// Include the original message if it has useful details
				if (
					cleanMessage.includes('usage limit') ||
					cleanMessage.includes('quota')
				) {
					return `Rate limit: ${cleanMessage}`;
				}
				return 'Rate limit exceeded: Too many requests. Please wait and try again';
			case '500':
			case '502':
			case '503':
				return `Server error: ${cleanMessage}`;
			default:
				return `Request failed (${statusCode}): ${cleanMessage}`;
		}
	}

	// Handle Ollama-specific unmarshal/JSON parsing errors
	// This runs AFTER status code parsing to avoid misclassifying HTTP errors
	// that happen to contain JSON parsing error text in their message
	if (
		errorMessage.includes('unmarshal') ||
		(errorMessage.includes('invalid character') &&
			errorMessage.includes('after top-level value'))
	) {
		return (
			'Ollama server error: The model returned malformed JSON. ' +
			'This usually indicates an issue with the Ollama server or model. ' +
			'Try:\n' +
			'  1. Restart Ollama: systemctl restart ollama (Linux) or restart the Ollama app\n' +
			'  2. Re-pull the model: ollama pull <model-name>\n' +
			'  3. Check Ollama logs for more details\n' +
			'  4. Try a different model to see if the issue is model-specific\n' +
			`Original error: ${errorMessage}`
		);
	}

	// Handle timeout errors
	if (
		lowerMessage.includes('timeout') ||
		errorMessage.includes('ETIMEDOUT') ||
		lowerMessage.includes('und_err_headers_timeout') ||
		lowerMessage.includes('headers timeout error')
	) {
		if (
			lowerMessage.includes('und_err_headers_timeout') ||
			lowerMessage.includes('headers timeout error')
		) {
			return (
				'Request timed out while waiting for model response headers. ' +
				'For slow local models, increase requestTimeout/socketTimeout in your provider config, ' +
				'or set both to -1 to disable timeouts.'
			);
		}

		return 'Request timed out: The model took too long to respond';
	}

	// Handle network errors
	if (
		errorMessage.includes('ECONNREFUSED') ||
		errorMessage.includes('ECONNRESET') ||
		errorMessage.includes('ENOTFOUND') ||
		errorMessage.includes('EAI_AGAIN') ||
		errorMessage.includes('connect ETIMEDOUT') ||
		lowerMessage.includes('failed to fetch') ||
		lowerMessage.includes('fetch failed') ||
		lowerMessage.includes('network error') ||
		lowerMessage.includes('getaddrinfo')
	) {
		const reason = describeConnectionReason(errorMessage);
		const cause = reason ? ` (${reason})` : '';
		return (
			`Couldn't reach ${describeProviderTarget(context)}${cause}. ` +
			`Is the server running? ${describeConfigHint(context)}`
		);
	}

	// Handle malformed baseUrl failures: an unset environment variable, a
	// missing scheme, or a blocked port. These surface from Node/undici as raw
	// one-word errors ("Invalid URL", "bad port", "unknown scheme") with no
	// indication of which provider or URL was at fault.
	const baseUrlProblem = describeBaseUrlProblem(
		errorMessage,
		getErrorCode(rootError),
	);
	if (baseUrlProblem) {
		const provider = context?.providerName
			? ` for provider "${context.providerName}"`
			: '';
		const url = context?.baseUrl ? ` (${context.baseUrl})` : '';
		return (
			`Invalid baseUrl${provider}${url}: ${baseUrlProblem}. ` +
			`${describeConfigHint(context)} It must be a complete URL ` +
			'(http:// or https://) and any environment variables it references ' +
			'must be set.'
		);
	}

	// Handle context length errors
	if (
		lowerMessage.includes('context length') ||
		lowerMessage.includes('too many tokens') ||
		lowerMessage.includes('available context size') ||
		lowerMessage.includes('context window') ||
		(lowerMessage.includes('exceeds') && lowerMessage.includes('context size'))
	) {
		return 'Context too large: Please reduce the conversation length or message size';
	}

	// Handle token limit errors
	if (errorMessage.includes('reduce the number of tokens')) {
		return 'Too many tokens: Please shorten your message or clear conversation history';
	}

	// If we can't parse it, return a cleaned up version
	return errorMessage.replace(/^Error:\s*/i, '').split('\n')[0];
}
