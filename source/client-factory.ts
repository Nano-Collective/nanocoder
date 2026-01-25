import {existsSync} from 'fs';
import {join} from 'path';
import {AISDKClient} from '@/ai-sdk-client';
import {getClosestConfigFile} from '@/config/index';
import {loadAllProviderConfigs} from '@/config/mcp-config-loader';
import {loadPreferences} from '@/config/preferences';
import {TIMEOUT_PROVIDER_CONNECTION_MS} from '@/constants';
import type {AIProviderConfig, LLMClient} from '@/types/index';

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
): Promise<{client: LLMClient; actualProvider: string}> {
	// Check if agents.config.json exists
	const agentsJsonPath = getClosestConfigFile('agents.config.json');
	const hasConfigFile = existsSync(agentsJsonPath);

	// Use AI SDK - it handles both tool-calling and non-tool-calling models
	return createAISDKClient(provider, hasConfigFile);
}

async function createAISDKClient(
	requestedProvider?: string,
	hasConfigFile = true,
): Promise<{client: LLMClient; actualProvider: string}> {
	// Load provider configs
	const providers = loadProviderConfigs();

	if (providers.length === 0) {
		const configPath = getClosestConfigFile('agents.config.json');
		const cwd = process.cwd();
		const isInCwd = configPath.startsWith(cwd);
		const cwdPath = !isInCwd ? join(cwd, 'agents.config.json') : undefined;

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

			// Test provider connection
			await testProviderConnection(providerConfig);

			const client = await AISDKClient.create(providerConfig);

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
		},
	}));
}

async function testProviderConnection(
	providerConfig: AIProviderConfig,
): Promise<void> {
	// Test local servers for connectivity
	if (
		providerConfig.config.baseURL &&
		providerConfig.config.baseURL.includes('localhost')
	) {
		try {
			await fetch(providerConfig.config.baseURL, {
				signal: AbortSignal.timeout(TIMEOUT_PROVIDER_CONNECTION_MS),
			});
			// Don't check response.ok as some servers return 404 for root path
			// We just need to confirm the server responded (not a network error)
		} catch (error) {
			// Only throw if it's a network error, not a 404 or other HTTP response
			if (error instanceof TypeError) {
				throw new Error(
					`Server not accessible at ${providerConfig.config.baseURL}`,
				);
			}
			// For AbortError (timeout), also throw
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error(
					`Server not accessible at ${providerConfig.config.baseURL}`,
				);
			}
			// Other errors (like HTTP errors) mean the server is responding, so pass
		}
	}
	// Require API key for hosted providers
	if (
		!providerConfig.config.apiKey &&
		!providerConfig.config.baseURL?.includes('localhost')
	) {
		throw new Error('API key required for hosted providers');
	}
}
