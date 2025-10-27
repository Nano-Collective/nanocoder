import {LangGraphClient} from '@/langgraph-client';
import {appConfig, getClosestConfigFile} from '@/config/index';
import {loadPreferences} from '@/config/preferences';
import type {LLMClient, LangChainProviderConfig} from '@/types/index';
import {existsSync} from 'fs';
import {join} from 'path';

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

	// Always use LangGraph - it handles both tool-calling and non-tool-calling models
	return createLangGraphClient(provider, hasConfigFile);
}

async function createLangGraphClient(
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

			const client = await LangGraphClient.create(providerConfig);

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

function loadProviderConfigs(): LangChainProviderConfig[] {
	const providers: LangChainProviderConfig[] = [];

	// Load providers from the new providers array structure
	if (appConfig.providers) {
		for (const provider of appConfig.providers) {
			providers.push({
				name: provider.name,
				type: 'openai',
				models: provider.models || [],
				requestTimeout: provider.requestTimeout,
				socketTimeout: provider.socketTimeout,
				disableThinking: true,
				connectionPool: provider.connectionPool,
				config: {
					baseURL: provider.baseUrl,
					apiKey: provider.apiKey || 'dummy-key',
				},
			});
		}
	}

	return providers;
}

async function testProviderConnection(
	providerConfig: LangChainProviderConfig,
): Promise<void> {
	// Test local servers for connectivity
	if (
		providerConfig.config.baseURL &&
		providerConfig.config.baseURL.includes('localhost')
	) {
		try {
			await fetch(providerConfig.config.baseURL, {
				signal: AbortSignal.timeout(5000),
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
