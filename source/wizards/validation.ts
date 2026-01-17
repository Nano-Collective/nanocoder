import {TIMEOUT_PROVIDER_CONNECTION_MS} from '@/constants';
import type {ProviderConfig} from '../types/config';
import type {McpServerConfig} from './templates/mcp-templates';

interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

interface ProviderTestResult {
	providerName: string;
	connected: boolean;
	error?: string;
}

/**
 * Validates the structure of the configuration object
 */
export function validateConfig(
	providers: ProviderConfig[],
	mcpServers: Record<string, McpServerConfig>,
): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Validate providers
	if (providers.length === 0) {
		warnings.push(
			'No providers configured. Nanocoder requires at least one provider to function.',
		);
	}

	for (const provider of providers) {
		if (!provider.name) {
			errors.push('Provider missing name');
		}

		if (!provider.models || provider.models.length === 0) {
			errors.push(`Provider "${provider.name}" has no models configured`);
		}

		// Validate base URL if present
		if (provider.baseUrl) {
			try {
				new URL(provider.baseUrl);
			} catch {
				errors.push(
					`Provider "${provider.name}" has invalid base URL: ${provider.baseUrl}`,
				);
			}
		}
	}

	// Validate MCP servers
	for (const [name, server] of Object.entries(mcpServers)) {
		if (!server.command) {
			errors.push(`MCP server "${name}" missing command`);
		}

		if (!server.args) {
			errors.push(`MCP server "${name}" missing args array`);
		}

		if (server.alwaysAllow && !Array.isArray(server.alwaysAllow)) {
			errors.push(
				`MCP server "${name}" has invalid alwaysAllow (must be an array of strings)`,
			);
		}

		if (Array.isArray(server.alwaysAllow)) {
			const invalidItems = server.alwaysAllow.filter(
				item => typeof item !== 'string',
			);
			if (invalidItems.length > 0) {
				errors.push(
					`MCP server "${name}" has non-string entries in alwaysAllow`,
				);
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Tests connectivity to a provider
 */
export async function testProviderConnection(
	provider: ProviderConfig,
	timeout = TIMEOUT_PROVIDER_CONNECTION_MS,
): Promise<ProviderTestResult> {
	// If no base URL, assume it's valid (will be validated when actually connecting)
	if (!provider.baseUrl) {
		return {
			providerName: provider.name,
			connected: true,
		};
	}

	try {
		const url = new URL(provider.baseUrl);

		// Only test localhost connections (don't want to spam cloud APIs)
		if (
			!url.hostname.includes('localhost') &&
			!url.hostname.includes('127.0.0.1')
		) {
			return {
				providerName: provider.name,
				connected: true, // Assume cloud APIs are reachable
			};
		}

		// Test localhost connection with a simple fetch
		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			controller.abort();
		}, timeout);

		const response = await fetch(provider.baseUrl, {
			method: 'GET',
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		return {
			providerName: provider.name,
			connected: response.ok || response.status === 404, // 404 is ok, server is running
		};
	} catch (error) {
		return {
			providerName: provider.name,
			connected: false,
			error:
				error instanceof Error
					? error.message
					: 'Unknown error testing connection',
		};
	}
}

/**
 * Provider configuration object format (for agents.config.json)
 */
interface ProviderConfigObject {
	nanocoder: {
		providers: Array<{
			name: string;
			models: string[];
			baseUrl?: string;
			apiKey?: string;
			organizationId?: string;
			timeout?: number;
		}>;
	};
}

/**
 * MCP configuration object format (for .mcp.json)
 * Uses Claude Code object format
 */
interface McpConfigObject {
	mcpServers: Record<string, McpServerConfig>;
}

/**
 * Builds the provider configuration object for agents.config.json
 */
export function buildProviderConfigObject(
	providers: ProviderConfig[],
): ProviderConfigObject {
	const config: ProviderConfigObject = {
		nanocoder: {
			providers: providers.map(p => {
				const providerConfig: {
					name: string;
					models: string[];
					baseUrl?: string;
					apiKey?: string;
					organizationId?: string;
					timeout?: number;
				} = {
					name: p.name,
					models: p.models,
				};

				if (p.baseUrl) {
					providerConfig.baseUrl = p.baseUrl;
				}

				if (p.apiKey) {
					providerConfig.apiKey = p.apiKey;
				}

				if (p.organizationId) {
					providerConfig.organizationId = p.organizationId;
				}

				if (p.timeout) {
					providerConfig.timeout = p.timeout;
				}

				return providerConfig;
			}),
		},
	};

	return config;
}

/**
 * Builds the MCP configuration object for .mcp.json
 * Uses Claude Code object format (servers as object keys)
 */
export function buildMcpConfigObject(
	mcpServers: Record<string, McpServerConfig>,
): McpConfigObject {
	// Add enabled flag to all servers configured via wizard
	const serversWithEnabled: Record<string, McpServerConfig> = {};
	for (const [key, server] of Object.entries(mcpServers)) {
		serversWithEnabled[key] = {
			...server,
			enabled: true, // Default to enabled for wizard configurations
		};
	}

	return {
		mcpServers: serversWithEnabled,
	};
}

/**
 * @deprecated Use buildProviderConfigObject and buildMcpConfigObject instead
 * This function is kept for backward compatibility during migration
 */
export function buildConfigObject(
	providers: ProviderConfig[],
	mcpServers: Record<string, McpServerConfig>,
): ProviderConfigObject & {
	nanocoder: {
		providers: Array<{
			name: string;
			models: string[];
			baseUrl?: string;
			apiKey?: string;
			organizationId?: string;
			timeout?: number;
		}>;
		mcpServers?: McpServerConfig[];
	};
} {
	const config: ProviderConfigObject & {
		nanocoder: {
			providers: Array<{
				name: string;
				models: string[];
				baseUrl?: string;
				apiKey?: string;
				organizationId?: string;
				timeout?: number;
			}>;
			mcpServers?: McpServerConfig[];
		};
	} = {
		nanocoder: {
			providers: providers.map(p => {
				const providerConfig: {
					name: string;
					models: string[];
					baseUrl?: string;
					apiKey?: string;
					organizationId?: string;
					timeout?: number;
				} = {
					name: p.name,
					models: p.models,
				};

				if (p.baseUrl) {
					providerConfig.baseUrl = p.baseUrl;
				}

				if (p.apiKey) {
					providerConfig.apiKey = p.apiKey;
				}

				if (p.organizationId) {
					providerConfig.organizationId = p.organizationId;
				}

				if (p.timeout) {
					providerConfig.timeout = p.timeout;
				}

				return providerConfig;
			}),
		},
	};

	// Add MCP servers if any - convert Record<string, McpServerConfig> to new array format
	if (Object.keys(mcpServers).length > 0) {
		config.nanocoder.mcpServers = Object.values(mcpServers).map(server => ({
			name: server.name,
			transport: server.transport || 'stdio', // Default to stdio for backward compatibility
			command: server.command,
			args: server.args,
			env: server.env,
			url: server.url,
			headers: server.headers,
			auth: server.auth,
			timeout: server.timeout,
			alwaysAllow: server.alwaysAllow,
			description: server.description,
			tags: server.tags,
			enabled: true, // Default to enabled for wizard configurations
		}));
	}

	return config;
}
