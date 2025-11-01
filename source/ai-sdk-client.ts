import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {generateText, streamText} from 'ai';
import type {ModelMessage} from 'ai';
import {Agent, fetch as undiciFetch} from 'undici';
import type {
	AIProviderConfig,
	LLMChatResponse,
	LLMClient,
	Message,
	ToolCall,
	AISDKCoreTool,
} from '@/types/index';
import {XMLToolCallParser} from '@/tool-calling/xml-parser';

/**
 * Parses API errors into user-friendly messages
 */
function parseAPIError(error: unknown): string {
	if (!(error instanceof Error)) {
		return 'An unknown error occurred while communicating with the model';
	}

	const errorMessage = error.message;

	// Extract status code and clean message from common error patterns
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
				return 'Rate limit exceeded: Too many requests. Please wait and try again';
			case '500':
			case '502':
			case '503':
				return `Server error: ${cleanMessage}`;
			default:
				return `Request failed (${statusCode}): ${cleanMessage}`;
		}
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
 * Phase 3 Migration: Now using proper ModelMessage types with AI SDK v5.
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

interface StreamCallbacks {
	onToken?: (token: string) => void;
	onToolCall?: (toolCall: ToolCall) => void;
	onFinish?: () => void;
}

export class AISDKClient implements LLMClient {
	private provider: ReturnType<typeof createOpenAICompatible>;
	private currentModel: string;
	private availableModels: string[];
	private providerConfig: AIProviderConfig;
	private undiciAgent: Agent;

	constructor(providerConfig: AIProviderConfig) {
		this.providerConfig = providerConfig;
		this.availableModels = providerConfig.models;
		this.currentModel = providerConfig.models[0] || '';

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
			// Type cast needed due to undici's Request type incompatibility with standard fetch
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return undiciFetch(url as any, {
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
	}

	getCurrentModel(): string {
		return this.currentModel;
	}

	getContextSize(): number {
		// Context size is not available without external model metadata service
		// This method is kept for LLMClient interface compatibility but always returns 0
		return 0;
	}

	getAvailableModels(): Promise<string[]> {
		return Promise.resolve(this.availableModels);
	}

	async chat(
		messages: Message[],
		tools: Record<string, AISDKCoreTool>,
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

			// Convert messages to AI SDK v5 ModelMessage format (Phase 3)
			const modelMessages = convertToModelMessages(messages);

			// Use generateText for non-streaming
			const result = await generateText({
				model,
				messages: modelMessages,
				tools: aiTools,
				abortSignal: signal,
			});

			// Extract tool calls from result
			const toolCalls: ToolCall[] = [];
			if (result.toolCalls && result.toolCalls.length > 0) {
				for (const toolCall of result.toolCalls) {
					toolCalls.push({
						id: toolCall.toolCallId,
						function: {
							name: toolCall.toolName,
							// AI SDK v5 uses 'input' for tool arguments
							arguments: toolCall.input as Record<string, unknown>,
						},
					});
				}
			}

			// If no native tool calls but tools are available, try XML parsing
			let content = result.text;
			if (
				Object.keys(tools).length > 0 &&
				toolCalls.length === 0 &&
				content &&
				XMLToolCallParser.hasToolCalls(content)
			) {
				const parsedToolCalls = XMLToolCallParser.parseToolCalls(content);
				const xmlToolCalls =
					XMLToolCallParser.convertToToolCalls(parsedToolCalls);
				const cleanedContent =
					XMLToolCallParser.removeToolCallsFromContent(content);

				content = cleanedContent;
				toolCalls.push(...xmlToolCalls);
			}

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
			// Check if this was a cancellation
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error('Operation was cancelled');
			}

			// Log detailed error for debugging
			console.error('AI SDK Error:', error);
			if (error instanceof Error) {
				console.error('Error message:', error.message);
				console.error('Error stack:', error.stack);
			}

			// Parse and throw a user-friendly error
			const userMessage = parseAPIError(error);
			throw new Error(userMessage);
		}
	}

	/**
	 * Stream chat with real-time token updates
	 */
	async chatStream(
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

			// Convert messages to AI SDK v5 ModelMessage format (Phase 3)
			const modelMessages = convertToModelMessages(messages);

			// Use streamText for streaming
			const result = streamText({
				model,
				messages: modelMessages,
				tools: aiTools,
				abortSignal: signal,
			});

			// Stream tokens
			let fullText = '';
			for await (const chunk of result.textStream) {
				fullText += chunk;
				callbacks.onToken?.(chunk);
			}

			// Wait for completion to get tool calls
			const toolCallsResult = await result.toolCalls;

			// Extract tool calls
			const toolCalls: ToolCall[] = [];
			if (toolCallsResult && toolCallsResult.length > 0) {
				for (const toolCall of toolCallsResult) {
					// Log the tool call structure for debugging
					console.log(
						'Stream tool call structure:',
						JSON.stringify(toolCall, null, 2),
					);

					const tc: ToolCall = {
						id: toolCall.toolCallId,
						function: {
							name: toolCall.toolName,
							// AI SDK v5 uses 'input' for tool arguments
							arguments: toolCall.input as Record<string, unknown>,
						},
					};
					toolCalls.push(tc);
					callbacks.onToolCall?.(tc);
				}
			}

			// Check for XML tool calls if no native ones
			let content = fullText;
			if (
				Object.keys(tools).length > 0 &&
				toolCalls.length === 0 &&
				content &&
				XMLToolCallParser.hasToolCalls(content)
			) {
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
			// Check if this was a cancellation
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error('Operation was cancelled');
			}

			// Log detailed error for debugging
			console.error('AI SDK Error:', error);
			if (error instanceof Error) {
				console.error('Error message:', error.message);
				console.error('Error stack:', error.stack);
			}

			// Parse and throw a user-friendly error
			const userMessage = parseAPIError(error);
			throw new Error(userMessage);
		}
	}

	async clearContext(): Promise<void> {
		// No internal state to clear
	}
}
