import {ChatOpenAI} from '@langchain/openai';
import {Agent, fetch, RequestInfo, RequestInit} from 'undici';
import {
	AIMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
	BaseMessage,
} from '@langchain/core/messages';
import type {
	Message,
	Tool,
	LLMClient,
	LangChainProviderConfig,
	LLMChatResponse,
} from '@/types/index';
import {XMLToolCallParser} from '@/tool-calling/xml-parser';

/**
 * Parses LangChain/API errors into user-friendly messages
 */
function parseAPIError(error: unknown): string {
	if (!(error instanceof Error)) {
		return 'An unknown error occurred while communicating with the model';
	}

	const errorMessage = error.message;

	// Extract status code and clean message from common error patterns
	// Pattern: "400 400 Bad Request: message" or "Error: 400 message"
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

	// Handle context length errors specifically
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
	// Remove "Error: " prefix and any technical stack traces
	return errorMessage.replace(/^Error:\s*/i, '').split('\n')[0];
}

/**
 * Converts our Message format to LangChain BaseMessage format
 */
function convertToLangChainMessage(message: Message): BaseMessage {
	switch (message.role) {
		case 'user':
			return new HumanMessage(message.content || '');
		case 'system':
			return new SystemMessage(message.content || '');
		case 'assistant':
			if (message.tool_calls && message.tool_calls.length > 0) {
				return new AIMessage({
					content: message.content || '',
					tool_calls: message.tool_calls.map(tc => ({
						id: tc.id,
						name: tc.function.name,
						args: tc.function.arguments,
					})),
				});
			}
			return new AIMessage(message.content || '');
		case 'tool':
			return new ToolMessage({
				content: message.content || '',
				tool_call_id: message.tool_call_id || '',
				name: message.name || '',
			});
		default: {
			const unknownMessage = message as {role: string};
			throw new Error(`Unsupported message role: ${unknownMessage.role}`);
		}
	}
}

/**
 * Converts LangChain AIMessage back to our Message format
 */
function convertFromLangChainMessage(message: AIMessage): Message {
	const result: Message = {
		role: 'assistant',
		content: message.content as string,
	};

	if (message.tool_calls && message.tool_calls.length > 0) {
		result.tool_calls = message.tool_calls.map(tc => ({
			id: tc.id || '',
			function: {
				name: tc.name,
				arguments: tc.args,
			},
		}));
	}

	return result;
}

interface ModelInfo {
	context_length?: number;
	[key: string]: unknown;
}

interface ChatConfig {
	modelName: string;
	openAIApiKey: string;
	configuration: {
		baseURL: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		fetch: any;
	};
	timeout?: number;
	maxTokens?: number;
	[key: string]: unknown;
}

export class LangGraphClient implements LLMClient {
	private chatModel: ChatOpenAI;
	private currentModel: string;
	private availableModels: string[];
	private providerConfig: LangChainProviderConfig;
	private modelInfoCache: Map<string, ModelInfo> = new Map();
	private undiciAgent: Agent;

	constructor(providerConfig: LangChainProviderConfig) {
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

		this.chatModel = this.createChatModel();
	}

	static create(
		providerConfig: LangChainProviderConfig,
	): Promise<LangGraphClient> {
		const client = new LangGraphClient(providerConfig);
		return Promise.resolve(client);
	}

	private createChatModel(): ChatOpenAI {
		const {config, requestTimeout} = this.providerConfig;

		const customFetch = (
			url: string | URL | Request,
			options: RequestInit = {},
		) => {
			// Ensure the abort signal is preserved from options
			return fetch(url as RequestInfo, {
				...options,
				signal: options.signal, // Explicitly preserve the signal
				dispatcher: this.undiciAgent,
			});
		};

		const chatConfig: ChatConfig = {
			modelName: this.currentModel,
			openAIApiKey: config.apiKey ?? 'dummy-key',
			configuration: {
				baseURL: config.baseURL ?? '',
				fetch: customFetch,
			},
			...config,
		};

		if (requestTimeout === -1) {
			chatConfig.timeout = undefined;
		} else if (requestTimeout) {
			chatConfig.timeout = requestTimeout;
		} else {
			// default
			chatConfig.timeout = 120000; // 2 minutes
		}

		return new ChatOpenAI(chatConfig);
	}

	setModel(model: string): void {
		this.currentModel = model;
		this.chatModel = this.createChatModel();
	}

	getCurrentModel(): string {
		return this.currentModel;
	}

	getContextSize(): number {
		// For OpenRouter, get from cached model info
		if (this.providerConfig.name === 'openrouter') {
			const modelData = this.modelInfoCache.get(this.currentModel);
			if (modelData?.context_length) {
				return modelData.context_length;
			}
			return 0;
		}

		// For OpenAI-compatible (local models), we can't reliably know the context
		if (this.providerConfig.name === 'openai-compatible') {
			return 0;
		}

		// Try to get from LangChain model if available
		const chatModelWithMaxTokens = this.chatModel as ChatOpenAI & {
			maxTokens?: number;
		};
		if (chatModelWithMaxTokens.maxTokens) {
			return chatModelWithMaxTokens.maxTokens;
		}

		return 0;
	}

	getAvailableModels(): Promise<string[]> {
		return Promise.resolve(this.availableModels);
	}

	async chat(
		messages: Message[],
		tools: Tool[],
		signal?: AbortSignal,
	): Promise<LLMChatResponse> {
		// Check if already aborted before starting
		if (signal?.aborted) {
			throw new Error('Operation was cancelled');
		}

		try {
			const langchainMessages = messages.map(convertToLangChainMessage);
			let result: AIMessage;

			// Create options object with abort signal if provided
			const invokeOptions = signal ? {signal} : {};

			// Try to bind tools if available - fallback to XML parsing
			if (tools.length > 0) {
				try {
					// Convert our tools to LangChain format
					const langchainTools = tools.map(tool => ({
						type: 'function' as const,
						function: {
							name: tool.function.name,
							description: tool.function.description,
							parameters: tool.function.parameters,
						},
					}));

					// Try binding tools to the model with parallel_tool_calls disabled
					const modelWithTools = this.chatModel.bindTools(langchainTools, {
						parallel_tool_calls: false,
					});
					result = (await modelWithTools.invoke(
						langchainMessages,
						invokeOptions,
					)) as AIMessage;
				} catch {
					// Tool binding failed, fall back to base model
					result = (await this.chatModel.invoke(
						langchainMessages,
						invokeOptions,
					)) as AIMessage;
				}
			} else {
				// No tools, use base model
				result = (await this.chatModel.invoke(
					langchainMessages,
					invokeOptions,
				)) as AIMessage;
			}

			let convertedMessage = convertFromLangChainMessage(result);

			// If no native tool calls but tools are available, try XML parsing
			if (
				tools.length > 0 &&
				(!convertedMessage.tool_calls ||
					convertedMessage.tool_calls.length === 0) &&
				convertedMessage.content
			) {
				const content = convertedMessage.content;

				if (XMLToolCallParser.hasToolCalls(content)) {
					const parsedToolCalls = XMLToolCallParser.parseToolCalls(content);
					const toolCalls =
						XMLToolCallParser.convertToToolCalls(parsedToolCalls);
					const cleanedContent =
						XMLToolCallParser.removeToolCallsFromContent(content);

					convertedMessage = {
						...convertedMessage,
						content: cleanedContent,
						tool_calls: toolCalls,
					};
				}
			}

			return {
				choices: [
					{
						message: {
							role: 'assistant' as const,
							content: convertedMessage.content,
							tool_calls: convertedMessage.tool_calls,
						},
					},
				],
			};
		} catch (error) {
			// Check if this was a cancellation
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error('Operation was cancelled');
			}

			// Parse and throw a user-friendly error
			const userMessage = parseAPIError(error);

			// Throw cleaned error for user display
			throw new Error(userMessage);
		}
	}

	async clearContext(): Promise<void> {
		// No internal state to clear in unified approach
	}
}
