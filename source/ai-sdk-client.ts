import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {generateText, stepCountIs, RetryError, APICallError} from 'ai';
import type {ModelMessage} from 'ai';
import {Agent, fetch as undiciFetch} from 'undici';
import type {
	AIProviderConfig,
	LLMChatResponse,
	LLMClient,
	Message,
	ToolCall,
	AISDKCoreTool,
	StreamCallbacks,
} from '@/types/index';
import {XMLToolCallParser} from '@/tool-calling/xml-parser';
import {getModelContextLimit} from '@/models/index.js';

/**
 * Message type used for testing the empty assistant message filter.
 * This is a simplified version of the AI SDK's internal message format.
 */
export interface TestableMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | unknown[];
	toolCalls?: unknown[];
}

/**
 * Checks if an assistant message is empty (no content and no tool calls).
 * Empty assistant messages cause API errors:
 * "400 Bad Request: Assistant message must have either content or tool_calls, but not none."
 *
 * Exported for testing purposes.
 */
export function isEmptyAssistantMessage(message: TestableMessage): boolean {
	if (message.role !== 'assistant') {
		return false;
	}
	// Check for content - handle both string and array content formats
	const hasContent = Array.isArray(message.content)
		? message.content.length > 0
		: typeof message.content === 'string' && message.content.trim().length > 0;
	// Tool calls are in a separate property for AI SDK messages
	const hasToolCalls =
		'toolCalls' in message &&
		Array.isArray(message.toolCalls) &&
		message.toolCalls.length > 0;
	return !hasContent && !hasToolCalls;
}

/**
 * Extracts the root cause error from AI SDK error wrappers.
 * AI SDK wraps errors in RetryError which contains lastError.
 */
function extractRootError(error: unknown): unknown {
	// Handle AI SDK RetryError - extract the last error
	if (RetryError.isInstance(error)) {
		if (error.lastError) {
			return extractRootError(error.lastError);
		}
	}
	return error;
}

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
				case 400:
					return `Bad request: ${cleanMessage}`;
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
	if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
		return 'Request timed out: The model took too long to respond';
	}

	// Handle network errors
	if (
		errorMessage.includes('ECONNREFUSED') ||
		errorMessage.includes('connect')
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

/**
 * Convert our Message format to AI SDK v5 ModelMessage format
 *
 * Tool messages: Converted to user messages with [Tool: name] prefix.
 * This approach is simpler and avoids issues with orphaned tool results
 * in multi-turn conversations.
 */
function convertToModelMessages(messages: Message[]): ModelMessage[] {
	return messages.map((msg): ModelMessage => {
		if (msg.role === 'tool') {
			// Convert tool results to user messages with clear labeling
			const toolName = msg.name || 'unknown_tool';
			return {
				role: 'user',
				content: `[Tool: ${toolName}]\n${msg.content}`,
			};
		}

		if (msg.role === 'system') {
			return {
				role: 'system',
				content: msg.content,
			};
		}

		if (msg.role === 'user') {
			return {
				role: 'user',
				content: msg.content,
			};
		}

		if (msg.role === 'assistant') {
			return {
				role: 'assistant',
				content: msg.content,
				// Note: tool_calls are handled separately by AI SDK
				// They come from the response, not the input messages
			};
		}

		// Fallback - should never happen
		return {
			role: 'user',
			content: msg.content,
		};
	});
}

export class AISDKClient implements LLMClient {
	private provider: ReturnType<typeof createOpenAICompatible>;
	private currentModel: string;
	private availableModels: string[];
	private providerConfig: AIProviderConfig;
	private undiciAgent: Agent;
	private cachedContextSize: number;
	private maxRetries: number;

	constructor(providerConfig: AIProviderConfig) {
		this.providerConfig = providerConfig;
		this.availableModels = providerConfig.models;
		this.currentModel = providerConfig.models[0] || '';
		this.cachedContextSize = 0;
		// Default to 2 retries (same as AI SDK default), or use configured value
		this.maxRetries = providerConfig.maxRetries ?? 2;

		const {requestTimeout, socketTimeout, connectionPool} = this.providerConfig;
		const resolvedSocketTimeout =
			socketTimeout === -1
				? 0
				: socketTimeout || requestTimeout === -1
				? 0
				: requestTimeout || 120000;

		this.undiciAgent = new Agent({
			connect: {
				timeout: resolvedSocketTimeout,
			},
			bodyTimeout: resolvedSocketTimeout,
			headersTimeout: resolvedSocketTimeout,
			keepAliveTimeout: connectionPool?.idleTimeout,
			keepAliveMaxTimeout: connectionPool?.cumulativeMaxIdleTimeout,
		});

		this.provider = this.createProvider();

		// Fetch context size asynchronously (don't block construction)
		void this.updateContextSize();
	}

	/**
	 * Fetch and cache context size from models.dev
	 */
	private async updateContextSize(): Promise<void> {
		try {
			const contextSize = await getModelContextLimit(this.currentModel);
			this.cachedContextSize = contextSize || 0;
		} catch {
			// Silently fail - context size will remain 0
			this.cachedContextSize = 0;
		}
	}

	static create(providerConfig: AIProviderConfig): Promise<AISDKClient> {
		const client = new AISDKClient(providerConfig);
		return Promise.resolve(client);
	}

	private createProvider(): ReturnType<typeof createOpenAICompatible> {
		const {config} = this.providerConfig;

		// Custom fetch using undici
		const customFetch = (
			url: string | URL | Request,
			options?: RequestInit,
		): Promise<Response> => {
			// Type cast to string | URL since undici's fetch accepts these types
			// Request objects are converted to URL internally by the fetch spec
			return undiciFetch(url as string | URL, {
				...options,
				dispatcher: this.undiciAgent,
			}) as Promise<Response>;
		};

		// Add OpenRouter-specific headers for app attribution
		const headers: Record<string, string> = {};
		if (this.providerConfig.name.toLowerCase() === 'openrouter') {
			headers['HTTP-Referer'] = 'https://github.com/Nano-Collective/nanocoder';
			headers['X-Title'] = 'Nanocoder';
		}

		return createOpenAICompatible({
			name: this.providerConfig.name,
			baseURL: config.baseURL ?? '',
			apiKey: config.apiKey ?? 'dummy-key',
			fetch: customFetch,
			headers,
		});
	}

	setModel(model: string): void {
		this.currentModel = model;
		// Update context size when model changes
		void this.updateContextSize();
	}

	getCurrentModel(): string {
		return this.currentModel;
	}

	getContextSize(): number {
		return this.cachedContextSize;
	}

	getMaxRetries(): number {
		return this.maxRetries;
	}

	getAvailableModels(): Promise<string[]> {
		return Promise.resolve(this.availableModels);
	}

	/**
	 * Stream chat with real-time token updates
	 */
	async chat(
		messages: Message[],
		tools: Record<string, AISDKCoreTool>,
		callbacks: StreamCallbacks,
		signal?: AbortSignal,
	): Promise<LLMChatResponse> {
		// Check if already aborted before starting
		if (signal?.aborted) {
			throw new Error('Operation was cancelled');
		}

		try {
			// Get the language model instance from the provider
			const model = this.provider(this.currentModel);

			// Tools are already in AI SDK format - use directly
			const aiTools = Object.keys(tools).length > 0 ? tools : undefined;

			// Convert messages to AI SDK v5 ModelMessage format
			const modelMessages = convertToModelMessages(messages);

			// Tools with needsApproval: false auto-execute in the loop
			// Tools with needsApproval: true cause interruptions for manual approval
			// stopWhen controls when the tool loop stops (max 10 steps)
			const result = await generateText({
				model,
				messages: modelMessages,
				tools: aiTools,
				abortSignal: signal,
				maxRetries: this.maxRetries,
				temperature: 0.6,
				stopWhen: stepCountIs(10), // Allow up to 10 tool execution steps
				// Can be used to add custom logging, metrics, or step tracking
				onStepFinish(step) {
					// Display formatters for auto-executed tools (after execution with results)
					if (
						step.toolCalls &&
						step.toolResults &&
						step.toolCalls.length === step.toolResults.length
					) {
						step.toolCalls.forEach((toolCall, idx) => {
							const toolResult = step.toolResults[idx];
							const tc: ToolCall = {
								id:
									toolCall.toolCallId ||
									`tool_${Date.now()}_${Math.random()
										.toString(36)
										.substring(7)}`,
								function: {
									name: toolCall.toolName,
									arguments: toolCall.input as Record<string, unknown>,
								},
							};
							const resultStr =
								typeof toolResult.output === 'string'
									? toolResult.output
									: JSON.stringify(toolResult.output);
							callbacks.onToolExecuted?.(tc, resultStr);
						});
					}
				},
				prepareStep: ({messages}) => {
					// Filter out empty assistant messages that would cause API errors
					// "Assistant message must have either content or tool_calls"
					const filteredMessages = messages.filter(
						m => !isEmptyAssistantMessage(m as unknown as TestableMessage),
					);

					// Return filtered messages if any were removed, otherwise no changes
					if (filteredMessages.length !== messages.length) {
						return {messages: filteredMessages};
					}
					return {}; // No modifications needed
				},
			});

			// Get the full text from the result
			const fullText = result.text;

			// Send the complete text to the callback
			if (fullText) {
				callbacks.onToken?.(fullText);
			}

			// Get tool calls from result
			const toolCallsResult = result.toolCalls;

			// Can inspect result.steps to see auto-executed tool calls and results
			// const steps = await result.steps;

			// Extract tool calls
			const toolCalls: ToolCall[] = [];
			if (toolCallsResult && toolCallsResult.length > 0) {
				for (const toolCall of toolCallsResult) {
					const tc: ToolCall = {
						// Some providers (like Ollama) don't provide toolCallId, so generate one
						id:
							toolCall.toolCallId ||
							`tool_${Date.now()}_${Math.random().toString(36).substring(7)}`,
						function: {
							name: toolCall.toolName,
							// AI SDK v5 uses 'input' for tool arguments
							arguments: toolCall.input as Record<string, unknown>,
						},
					};
					toolCalls.push(tc);
					// Note: onToolCall already fired in onStepFinish - no need to call again
				}
			}

			// Check for XML tool calls if no native ones
			let content = fullText;
			if (Object.keys(tools).length > 0 && toolCalls.length === 0 && content) {
				// First check for malformed XML tool calls
				const malformedError =
					XMLToolCallParser.detectMalformedToolCall(content);
				if (malformedError) {
					// Return malformed tool call with validation error
					// This mimics how validators work - returns tool call that will show error
					const malformedCall: ToolCall = {
						id: 'malformed_xml_validation',
						function: {
							name: '__xml_validation_error__',
							arguments: {
								error: malformedError.error,
							},
						},
					};
					toolCalls.push(malformedCall);
					callbacks.onToolCall?.(malformedCall);
					content = ''; // Clear content since it was malformed
				} else if (XMLToolCallParser.hasToolCalls(content)) {
					// Try to parse well-formed XML tool calls
					const parsedToolCalls = XMLToolCallParser.parseToolCalls(content);
					const xmlToolCalls =
						XMLToolCallParser.convertToToolCalls(parsedToolCalls);
					const cleanedContent =
						XMLToolCallParser.removeToolCallsFromContent(content);

					content = cleanedContent;
					for (const tc of xmlToolCalls) {
						toolCalls.push(tc);
						callbacks.onToolCall?.(tc);
					}
				}
			}

			callbacks.onFinish?.();

			return {
				choices: [
					{
						message: {
							role: 'assistant',
							content,
							tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
						},
					},
				],
			};
		} catch (error) {
			// Check if this was a user-initiated cancellation
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error('Operation was cancelled');
			}

			// AI SDK wraps errors in NoOutputGeneratedError with no useful cause
			// Check if it's a cancellation without an underlying API error
			if (
				error instanceof Error &&
				(error.name === 'AI_NoOutputGeneratedError' ||
					error.message.includes('No output generated'))
			) {
				// Check if there's an underlying RetryError with the real cause
				const rootError = extractRootError(error);
				if (rootError === error) {
					// No underlying error - this is just a cancellation
					throw new Error('Operation was cancelled');
				}
				// There's a real error underneath, parse it
				const userMessage = parseAPIError(rootError);
				throw new Error(userMessage);
			}

			// Parse any other error (including RetryError and APICallError)
			const userMessage = parseAPIError(error);
			throw new Error(userMessage);
		}
	}

	async clearContext(): Promise<void> {
		// No internal state to clear
	}
}
