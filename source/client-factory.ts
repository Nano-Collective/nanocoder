import {existsSync} from 'fs';
import {join} from 'path';
import {AISDKClient} from '@/ai-sdk-client';
import {
	getCodexNoCredentialsMessage,
	loadCodexCredential,
} from '@/config/codex-credentials';
import {
	getCopilotNoCredentialsMessage,
	loadCopilotCredential,
} from '@/config/copilot-credentials';
import {getClosestConfigFile} from '@/config/index';
import {loadAllProviderConfigs} from '@/config/mcp-config-loader';
import {loadPreferences} from '@/config/preferences';
import type {AIProviderConfig, LLMClient} from '@/types/index';
import {isLocalURL} from '@/utils/url-utils';

// Custom error class for configuration errors that need special UI handling
export class ConfigurationError extends Error {
	constructor(
		message: string,
		public configPath: string,
		public cwdPath?: string,
		public isEmptyConfig: boolean = false,
	) {
		super(message);
		this.name = 'ConfigurationError';
	}
}

export async function createLLMClient(
	provider?: string,
	model?: string,
): Promise<{client: LLMClient; actualProvider: string}> {
	// Check if agents.config.json exists
	const agentsJsonPath = getClosestConfigFile('agents.config.json');
	const hasConfigFile = existsSync(agentsJsonPath);

	// Use AI SDK - it handles both tool-calling and non-tool-calling models
	return createAISDKClient(provider, model, hasConfigFile);
}

async function createAISDKClient(
	requestedProvider?: string,
	requestedModel?: string,
	hasConfigFile = true,
): Promise<{client: LLMClient; actualProvider: string}> {
	// Load provider configs
	const providers = loadProviderConfigs();

	const configPath = getClosestConfigFile('agents.config.json');
	const cwd = process.cwd();
	const isInCwd = configPath.startsWith(cwd);
	const cwdPath = !isInCwd ? join(cwd, 'agents.config.json') : undefined;

	if (providers.length === 0) {
		if (!hasConfigFile) {
			throw new ConfigurationError(
				'No agents.config.json found',
				configPath,
				cwdPath,
				false,
			);
		} else {
			throw new ConfigurationError(
				'No providers configured in agents.config.json',
				configPath,
				cwdPath,
				true,
			);
		}
	}

	// Determine which provider to try first
	let targetProvider: string;
	if (requestedProvider) {
		targetProvider = requestedProvider;
	} else {
		// Use preferences or default to first available provider
		const preferences = loadPreferences();
		targetProvider = preferences.lastProvider || providers[0].name;
	}

	// Validate provider exists if specified
	if (requestedProvider) {
		const providerConfig = providers.find(p => p.name === requestedProvider);
		if (!providerConfig) {
			const availableProviders = providers.map(p => p.name).join(', ');
			throw new ConfigurationError(
				`Provider '${requestedProvider}' not found in agents.config.json. Available providers: ${availableProviders}`,
				configPath,
				cwdPath,
				false,
			);
		}
	}

	// Validate model exists in the target provider's model list if specified
	if (requestedModel) {
		const resolvedProviderConfig =
			providers.find(p => p.name === targetProvider) || providers[0];
		if (
			resolvedProviderConfig &&
			resolvedProviderConfig.models.length > 0 &&
			!resolvedProviderConfig.models.includes(requestedModel)
		) {
			const availableModels = resolvedProviderConfig.models.join(', ');
			throw new ConfigurationError(
				`Model '${requestedModel}' not available for provider '${resolvedProviderConfig.name}'. Available models: ${availableModels}`,
				configPath,
				cwdPath,
				false,
			);
		}
	}

	// Order providers: requested first, then others
	const availableProviders = providers.map(p => p.name);
	const providerOrder = [
		targetProvider,
		...availableProviders.filter(p => p !== targetProvider),
	];

	const errors: string[] = [];

	for (const providerType of providerOrder) {
		try {
			const providerConfig = providers.find(p => p.name === providerType);
			if (!providerConfig) {
				continue;
			}

			// Validate credentials (sync, no network calls)
			validateProviderCredentials(providerConfig);

			const client = await AISDKClient.create(providerConfig);

			// Set model if specified
			if (requestedModel) {
				client.setModel(requestedModel);
			}

			return {client, actualProvider: providerType};
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : 'Unknown error';
			errors.push(`${providerType}: ${errorMessage}`);
		}
	}

	// If we get here, all providers failed
	if (!hasConfigFile) {
		const combinedError = `No providers available: ${
			errors[0]?.split(': ')[1] || 'Unknown error'
		}\n\nPlease create an agents.config.json file with provider configuration.`;
		throw new Error(combinedError);
	} else {
		const combinedError = `All configured providers failed:\n${errors
			.map(e => `• ${e}`)
			.join(
				'\n',
			)}\n\nPlease check your provider configuration in agents.config.json`;
		throw new Error(combinedError);
	}
}

function loadProviderConfigs(): AIProviderConfig[] {
	// Use the new hierarchical provider loading system to get providers from all levels
	const allProviderConfigs = loadAllProviderConfigs();

	return allProviderConfigs.map(provider => ({
		name: provider.name,
		type: 'openai' as const,
		models: provider.models || [],
		requestTimeout: provider.requestTimeout,
		socketTimeout: provider.socketTimeout,
		connectionPool: provider.connectionPool,
		// Tool configuration
		disableTools: provider.disableTools,
		disableToolModels: provider.disableToolModels,
		// SDK provider package to use
		sdkProvider: provider.sdkProvider,
		config: {
			baseURL: provider.baseUrl,
			apiKey: provider.apiKey || 'dummy-key',
			headers: provider.headers ?? {},
		},
	}));
}

/**
 * Validate that the provider has the credentials it needs. No network
 * calls — connectivity is verified on first actual LLM request, where
 * the error handling already exists. This keeps boot fast and avoids
 * blocking on local servers (Ollama) or remote APIs that might be slow.
 */
function validateProviderCredentials(providerConfig: AIProviderConfig): void {
	// GitHub Copilot: require stored credential
	if (providerConfig.sdkProvider === 'github-copilot') {
		const credential = loadCopilotCredential(providerConfig.name);
		if (!credential?.oauthToken) {
			throw new Error(getCopilotNoCredentialsMessage(providerConfig.name));
		}
		return;
	}

	// ChatGPT/Codex: require stored credential
	if (providerConfig.sdkProvider === 'chatgpt-codex') {
		const credential = loadCodexCredential(providerConfig.name);
		if (!credential?.accessToken) {
			throw new Error(getCodexNoCredentialsMessage(providerConfig.name));
		}
		return;
	}

	// Require API key for hosted providers (local servers get a pass)
	if (
		!providerConfig.config.apiKey &&
		!(
			providerConfig.config.baseURL && isLocalURL(providerConfig.config.baseURL)
		)
	) {
		throw new Error('API key required for hosted providers');
	}
}
