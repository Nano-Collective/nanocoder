import {APICallError} from 'ai';
import {extractRootError} from './error-extractor.js';

/**
 * Parses API errors into user-friendly messages.
 * Exported for testing purposes.
 */
export function parseAPIError(error: unknown): string {
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
					error?: {message?: string};
					message?: string;
				};
				if (body.error?.message) {
					cleanMessage = body.error.message;
				} else if (body.message) {
					cleanMessage = body.message;
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
		errorMessage.includes('connect ETIMEDOUT') ||
		errorMessage.includes('Failed to fetch')
	) {
		return 'Connection failed: Unable to reach the model server';
	}

	// Handle context length errors
	if (
		errorMessage.includes('context length') ||
		errorMessage.includes('too many tokens')
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
