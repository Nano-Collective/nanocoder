import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {
	generateText,
	streamText,
	stepCountIs,
	NoSuchToolError,
	InvalidToolInputError,
} from 'ai';
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
	ChatOptions,
	StepResult,
	ToolError,
} from '@/types/index';
import {XMLToolCallParser} from '@/tool-calling/xml-parser';
import {getModelContextLimit} from '@/models/index.js';

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

	constructor(providerConfig: AIProviderConfig) {
		this.providerConfig = providerConfig;
		this.availableModels = providerConfig.models;
		this.currentModel = providerConfig.models[0] || '';
		this.cachedContextSize = 0;

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

	getAvailableModels(): Promise<string[]> {
		return Promise.resolve(this.availableModels);
	}

	async chat(
		messages: Message[],
		tools: Record<string, AISDKCoreTool>,
		options?: ChatOptions,
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

			// Use generateText for non-streaming
			const result = await generateText({
				model,
				messages: modelMessages,
				tools: aiTools,
				abortSignal: signal,

				// Phase 1.1: Multi-step tool calling
				stopWhen: options?.enableMultiStep
					? stepCountIs(options.maxSteps || 5)
					: undefined,

				// Phase 1.2: Tool choice control
				toolChoice: options?.toolChoice,

				// Phase 1.2: Active tools filtering
				activeTools: options?.activeTools,

				// Phase 1.3: Step finish callback
				onStepFinish: options?.stepCallbacks?.onStepFinish
					? ({text, toolCalls, toolResults, finishReason, usage}) => {
							const stepResult: StepResult = {
								text,
								toolCalls,
								toolResults,
								finishReason,
								usage,
							};
							options.stepCallbacks?.onStepFinish?.(stepResult);
					  }
					: undefined,

				// Phase 1.3: Prepare step callback
				prepareStep: options?.stepCallbacks?.prepareStep
					? async ({stepNumber, steps, messages}) => {
							const stepResults: StepResult[] = steps.map(step => ({
								text: step.text,
								toolCalls: step.toolCalls,
								toolResults: step.toolResults,
								finishReason: step.finishReason,
								usage: step.usage,
								response: step.response,
							}));

							const config = await options.stepCallbacks!.prepareStep!({
								stepNumber,
								steps: stepResults,
								messages,
							});

							return config;
					  }
					: undefined,

				// Phase 1.4: Experimental context
				experimental_context: options?.experimental_context,
			});

			// Extract tool calls from result
			const toolCalls: ToolCall[] = [];
			if (result.toolCalls && result.toolCalls.length > 0) {
				for (const toolCall of result.toolCalls) {
					toolCalls.push({
						// Some providers (like Ollama) don't provide toolCallId, so generate one
						id:
							toolCall.toolCallId ||
							`tool_${Date.now()}_${Math.random().toString(36).substring(7)}`,
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
			if (Object.keys(tools).length > 0 && toolCalls.length === 0 && content) {
				// First check for malformed XML tool calls
				const malformedError =
					XMLToolCallParser.detectMalformedToolCall(content);
				if (malformedError) {
					// Return malformed tool call with validation error
					// This mimics how validators work - returns tool call that will show error
					toolCalls.push({
						id: 'malformed_xml_validation',
						function: {
							name: '__xml_validation_error__',
							arguments: {
								error: malformedError.error,
							},
						},
					});
					content = ''; // Clear content since it was malformed
				} else if (XMLToolCallParser.hasToolCalls(content)) {
					// Try to parse well-formed XML tool calls
					const parsedToolCalls = XMLToolCallParser.parseToolCalls(content);
					const xmlToolCalls =
						XMLToolCallParser.convertToToolCalls(parsedToolCalls);
					const cleanedContent =
						XMLToolCallParser.removeToolCallsFromContent(content);

					content = cleanedContent;
					toolCalls.push(...xmlToolCalls);
				}
			}

			// Phase 1.2: Convert steps to our format
			const steps: StepResult[] | undefined = result.steps
				? result.steps.map(step => ({
						text: step.text,
						toolCalls: step.toolCalls,
						toolResults: step.toolResults,
						finishReason: step.finishReason,
						usage: step.usage,
						response: step.response,
				  }))
				: undefined;

			// Phase 1.5: Extract tool errors from steps (simplified)
			const toolErrors: ToolError[] | undefined = undefined;

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
				// Phase 1.2: Return response messages for conversation history
				responseMessages: result.response?.messages,
				// Phase 1.2: Return steps for multi-step execution tracking
				steps,
				// Phase 1.5: Return tool errors
				toolErrors,
			};
		} catch (error) {
			// Check if this was a cancellation
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error('Operation was cancelled');
			}

			// Check for AI SDK's NoOutputGeneratedError (thrown when stream is aborted)
			if (
				error instanceof Error &&
				(error.name === 'AI_NoOutputGeneratedError' ||
					error.message.includes('No output generated'))
			) {
				throw new Error('Operation was cancelled');
			}

			// Phase 1.5: Handle AI SDK tool-specific errors
			if (NoSuchToolError.isInstance(error)) {
				throw new Error('The model tried to call an unknown tool');
			}

			if (InvalidToolInputError.isInstance(error)) {
				throw new Error('The model called a tool with invalid inputs');
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
		options?: ChatOptions,
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

			// Use streamText for streaming
			const result = streamText({
				model,
				messages: modelMessages,
				tools: aiTools,
				abortSignal: signal,

				// Phase 1.1: Multi-step tool calling
				stopWhen: options?.enableMultiStep
					? stepCountIs(options.maxSteps || 5)
					: undefined,

				// Phase 1.2: Tool choice control
				toolChoice: options?.toolChoice,

				// Phase 1.2: Active tools filtering
				activeTools: options?.activeTools,

				// Phase 1.3: Step finish callback
				onStepFinish: options?.stepCallbacks?.onStepFinish
					? ({text, toolCalls, toolResults, finishReason, usage}) => {
							const stepResult: StepResult = {
								text,
								toolCalls,
								toolResults,
								finishReason,
								usage,
							};
							options.stepCallbacks?.onStepFinish?.(stepResult);
					  }
					: undefined,

				// Phase 1.3: Prepare step callback
				prepareStep: options?.stepCallbacks?.prepareStep
					? async ({stepNumber, steps, messages}) => {
							const stepResults: StepResult[] = steps.map(step => ({
								text: step.text,
								toolCalls: step.toolCalls,
								toolResults: step.toolResults,
								finishReason: step.finishReason,
								usage: step.usage,
								response: step.response,
							}));

							const config = await options.stepCallbacks!.prepareStep!({
								stepNumber,
								steps: stepResults,
								messages,
							});

							return config;
					  }
					: undefined,

				// Phase 1.4: Experimental context
				experimental_context: options?.experimental_context,
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
					callbacks.onToolCall?.(tc);
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

			// Wait for result to complete
			const [finalResult, stepsResult] = await Promise.all([
				result,
				result.steps,
			]);

			// Phase 1.2: Convert steps to our format
			const steps: StepResult[] | undefined = stepsResult
				? stepsResult.map(step => ({
						text: step.text,
						toolCalls: step.toolCalls,
						toolResults: step.toolResults,
						finishReason: step.finishReason,
						usage: step.usage,
						response: step.response,
				  }))
				: undefined;

			// Phase 1.5: Extract tool errors from steps (simplified)
			const toolErrors: ToolError[] | undefined = undefined;

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
				// Phase 1.2: Return response messages for conversation history
				responseMessages: (await finalResult.response).messages,
				// Phase 1.2: Return steps for multi-step execution tracking
				steps,
				// Phase 1.5: Return tool errors
				toolErrors,
			};
		} catch (error) {
			// Check if this was a cancellation
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error('Operation was cancelled');
			}

			// Check for AI SDK's NoOutputGeneratedError (thrown when stream is aborted)
			if (
				error instanceof Error &&
				(error.name === 'AI_NoOutputGeneratedError' ||
					error.message.includes('No output generated'))
			) {
				throw new Error('Operation was cancelled');
			}

			// Phase 1.5: Handle AI SDK tool-specific errors
			if (NoSuchToolError.isInstance(error)) {
				throw new Error('The model tried to call an unknown tool');
			}

			if (InvalidToolInputError.isInstance(error)) {
				throw new Error('The model called a tool with invalid inputs');
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
