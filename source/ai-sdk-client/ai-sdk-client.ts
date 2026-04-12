import type {OpenAIProvider} from '@ai-sdk/openai';
import type {LanguageModel} from 'ai';
import {Agent} from 'undici';
import {
	TIMEOUT_SOCKET_DEFAULT_MS,
	TIMEOUT_SOCKET_LOCAL_DEFAULT_MS,
} from '@/constants';
import {getModelContextLimit} from '@/models/index.js';
import type {
	AIProviderConfig,
	AISDKCoreTool,
	LLMChatResponse,
	LLMClient,
	Message,
	ModeOverrides,
	StreamCallbacks,
} from '@/types/index';
import {getLogger} from '@/utils/logging';
import {isLocalURL} from '@/utils/url-utils';
import {handleChat} from './chat/chat-handler.js';
import {type AIProvider, createProvider} from './providers/provider-factory.js';

export class AISDKClient implements LLMClient {
	// Definite-assignment: populated by the async `create()` factory before
	// the client is handed to callers. The constructor only does sync setup.
	private provider!: AIProvider;
	private currentModel: string;
	private availableModels: string[];
	private providerConfig: AIProviderConfig;
	private undiciAgent: Agent;
	private cachedContextSize: number;
	private maxRetries: number;

	constructor(providerConfig: AIProviderConfig) {
		const logger = getLogger();

		this.providerConfig = providerConfig;
		this.availableModels = providerConfig.models;
		this.currentModel = providerConfig.models[0] || '';
		this.cachedContextSize = 0;
		// Default to 2 retries (same as AI SDK default), or use configured value
		this.maxRetries = providerConfig.maxRetries ?? 2;

		logger.info('AI SDK client initializing', {
			models: this.availableModels,
			defaultModel: this.currentModel,
			provider: providerConfig.name || 'unknown',
			baseUrl: providerConfig.config.baseURL ? '[REDACTED]' : undefined,
			maxRetries: this.maxRetries,
		});

		const {connectionPool} = this.providerConfig;
		const {requestTimeout, socketTimeout} = this.providerConfig;
		const effectiveSocketTimeout = socketTimeout ?? requestTimeout;
		const isLocal =
			providerConfig.config.baseURL &&
			isLocalURL(providerConfig.config.baseURL);
		const defaultTimeout = isLocal
			? TIMEOUT_SOCKET_LOCAL_DEFAULT_MS
			: TIMEOUT_SOCKET_DEFAULT_MS;
		const resolvedSocketTimeout =
			effectiveSocketTimeout === -1
				? 0
				: (effectiveSocketTimeout ?? defaultTimeout);

		this.undiciAgent = new Agent({
			connect: {
				timeout: resolvedSocketTimeout,
			},
			bodyTimeout: resolvedSocketTimeout,
			headersTimeout: resolvedSocketTimeout,
			keepAliveTimeout: connectionPool?.idleTimeout,
			keepAliveMaxTimeout: connectionPool?.cumulativeMaxIdleTimeout,
		});

		// Fetch context size asynchronously (don't block construction)
		void this.updateContextSize();
	}

	/**
	 * Fetch and cache context size from models.dev
	 */
	private async updateContextSize(): Promise<void> {
		const logger = getLogger();
		try {
			const contextSize = await getModelContextLimit(this.currentModel);
			this.cachedContextSize = contextSize || 0;
		} catch (error) {
			logger.debug('Failed to get model context size', {
				model: this.currentModel,
				error,
			});
			this.cachedContextSize = 0;
		}
	}

	static async create(providerConfig: AIProviderConfig): Promise<AISDKClient> {
		const client = new AISDKClient(providerConfig);
		// Async provider creation — lazily loads only the SDK package the
		// configured `sdkProvider` actually needs.
		client.provider = await createProvider(
			client.providerConfig,
			client.undiciAgent,
		);
		return client;
	}

	setModel(model: string): void {
		const logger = getLogger();
		const previousModel = this.currentModel;

		this.currentModel = model;

		logger.info('Model changed', {
			previousModel,
			newModel: model,
			provider: this.providerConfig.name,
		});

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
		modeOverrides?: ModeOverrides,
	): Promise<LLMChatResponse> {
		// Get the language model instance from the provider
		// GitHub Copilot requires routing: GPT-5+ → Responses API, others → Chat Completions
		// ChatGPT/Codex always uses the Responses API
		let model: LanguageModel;
		if (this.providerConfig.sdkProvider === 'chatgpt-codex') {
			const codex = this.provider as unknown as OpenAIProvider;
			model = codex.responses(this.currentModel);
		} else if (this.providerConfig.sdkProvider === 'github-copilot') {
			const copilot = this.provider as unknown as OpenAIProvider;
			model = this.currentModel.includes('gpt-5')
				? copilot.responses(this.currentModel)
				: copilot.chat(this.currentModel);
		} else {
			model = this.provider(this.currentModel) as unknown as LanguageModel;
		}

		// Delegate to chat handler
		return await handleChat({
			model,
			currentModel: this.currentModel,
			providerConfig: this.providerConfig,
			messages,
			tools,
			callbacks,
			signal,
			maxRetries: this.maxRetries,
			modeOverrides,
		});
	}

	clearContext(): Promise<void> {
		const logger = getLogger();

		logger.debug('AI SDK client context cleared', {
			model: this.currentModel,
			provider: this.providerConfig.name,
		});

		// No internal state to clear
		return Promise.resolve();
	}

	getTimeout(): number | undefined {
		return (
			this.providerConfig.socketTimeout ?? this.providerConfig.requestTimeout
		);
	}
}
