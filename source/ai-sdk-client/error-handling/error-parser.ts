import {APICallError} from 'ai';
import {extractRootError} from './error-extractor.js';

interface APIErrorContext {
	providerName?: string;
	baseUrl?: string;
}

const NETWORK_ERROR_HINTS: Record<string, string> = {
	ECONNREFUSED:
		'Connection refused. Is the model server running and listening on this port?',
	ENOTFOUND:
		'Hostname could not be resolved. Check the hostname and DNS settings.',
	EAI_AGAIN:
		'DNS lookup temporarily failed. Check your network connection and retry.',
	ECONNRESET: 'Connection was reset. Check the server and network connection.',
	ETIMEDOUT: 'Connection timed out. Check whether the server is reachable.',
};

function getNetworkErrorCode(error: unknown): string | undefined {
	const visited = new Set<unknown>();
	let current: unknown = error;

	while (current && typeof current === 'object' && !visited.has(current)) {
		visited.add(current);

		const candidate = current as {
			code?: unknown;
			cause?: unknown;
			message?: unknown;
		};

		if (
			typeof candidate.code === 'string' &&
			Object.hasOwn(NETWORK_ERROR_HINTS, candidate.code)
		) {
			return candidate.code;
		}

		if (typeof candidate.message === 'string') {
			const message = candidate.message;
			const code = Object.keys(NETWORK_ERROR_HINTS).find(value =>
				message.includes(value),
			);

			if (code) return code;
		}

		current = candidate.cause;
	}

	return undefined;
}

function safeProviderUrl(baseUrl?: string): string {
	if (!baseUrl?.trim()) return '(not configured)';

	try {
		const url = new URL(baseUrl);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return '(invalid URL)';
		}
		url.username = '';
		url.password = '';
		url.search = '';
		url.hash = '';
		return url.toString();
	} catch {
		// Do not echo malformed URLs: they may contain credentials.
		return '(invalid URL)';
	}
}

function providerDetails(context?: APIErrorContext): string {
	const provider = `provider "${context?.providerName ?? 'unknown'}"`;
	const url = safeProviderUrl(context?.baseUrl);

	if (url === '(not configured)' || url === '(invalid URL)') {
		return `${provider} (baseUrl: ${url})`;
	}

	return `${provider} at ${url}`;
}
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
 * Parses API errors into user-friendly messages.
 * Exported for testing purposes.
 */
export function parseAPIError(
	error: unknown,
	context?: APIErrorContext,
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
	context?: APIErrorContext,
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
				case 402: {
					// Some providers (Groq, custom gateways) return 402 for free-tier
					// quota exhaustion or billing requirements rather than 429. Surface
					// the payload so the user can tell which case they hit.
					const lowered = cleanMessage.toLowerCase();
					if (
						lowered.includes('quota') ||
						lowered.includes('rate') ||
						lowered.includes('limit') ||
						lowered.includes('free tier')
					) {
						return `Quota exceeded: ${cleanMessage}`;
					}
					return `Payment required: ${cleanMessage}`;
				}
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

	// Node.js may include credentials and query parameters in this error.
	// Never return the raw message because it can contain secrets.
	if (
		lowerMessage.includes(
			'request cannot be constructed from a url that includes credentials',
		)
	) {
		return (
			`Invalid provider URL for ${providerDetails(context)}. ` +
			'URLs containing embedded credentials are not supported. ' +
			'Remove the username and password from baseUrl and configure ' +
			'authentication separately.'
		);
	}

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
			case '402': {
				const lowered = cleanMessage.toLowerCase();
				if (
					lowered.includes('quota') ||
					lowered.includes('rate') ||
					lowered.includes('limit') ||
					lowered.includes('free tier')
				) {
					return `Quota exceeded: ${cleanMessage}`;
				}
				return `Payment required: ${cleanMessage}`;
			}
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
		if (getNetworkErrorCode(error) === 'ETIMEDOUT') {
			return (
				`Connection failed: Could not reach ${providerDetails(context)} ` +
				`(ETIMEDOUT). ${NETWORK_ERROR_HINTS.ETIMEDOUT} ` +
				'Check baseUrl in your provider configuration.'
			);
		}

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

	// Handle network failures and nested transport error causes.
	const networkCode =
		getNetworkErrorCode(error) ?? getNetworkErrorCode(rootError);
	if (
		networkCode ||
		lowerMessage.includes('failed to fetch') ||
		lowerMessage.includes('fetch failed') ||
		lowerMessage.includes('network error') ||
		lowerMessage.includes('getaddrinfo')
	) {
		const hint = networkCode
			? NETWORK_ERROR_HINTS[networkCode]
			: 'Check that the model server is running and reachable.';
		const cause = networkCode ? ` (${networkCode})` : '';
		return (
			`Connection failed: Could not reach ${providerDetails(context)}` +
			`${cause}. ${hint} Check baseUrl in your provider configuration.`
		);
	}

	// Explain malformed URLs instead of showing raw Node.js errors.
	const isInvalidUrl =
		lowerMessage.includes('invalid url') ||
		lowerMessage.includes('bad port') ||
		lowerMessage.includes('unknown scheme') ||
		lowerMessage.includes('invalid protocol') ||
		lowerMessage.includes('unsupported protocol');

	if (isInvalidUrl) {
		const baseUrl = context?.baseUrl;
		let hint: string;

		if (!baseUrl?.trim() || /^\$\{[^}]+\}$/.test(baseUrl.trim())) {
			hint =
				'The baseUrl is missing or unresolved. Check your environment variables and provider configuration.';
		} else if (!/^https?:\/\//i.test(baseUrl)) {
			hint = 'The baseUrl must start with http:// or https://.';
		} else {
			hint = 'Check the baseUrl syntax, hostname, port, and protocol.';
		}

		return `Invalid provider URL for ${providerDetails(context)}. ${hint}`;
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
