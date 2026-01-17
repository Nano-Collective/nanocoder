import {existsSync, readFileSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';
import {substituteEnvVars} from '@/config/env-substitution';
import {getConfigPath} from '@/config/paths';
import type {MCPServerConfig, ProviderConfig} from '@/types/config';
import {logError} from '@/utils/message-queue';

// Simplified configuration source types
export type ConfigSource = 'project' | 'global';

export interface MCPServerWithSource {
	server: MCPServerConfig;
	source: ConfigSource;
}

/**
 * Show deprecation warning for array format MCP configuration
 */
function showArrayFormatDeprecationWarning() {
	logError('Warning: Array format for MCP servers is deprecated.');
	logError(
		'Please use object format: { "mcpServers": { "serverName": { ... } } }',
	);
}

/**
 * Show deprecation warning for MCP servers in agents.config.json
 */
function showAgentsConfigDeprecationWarning() {
	const _configPath = join(getConfigPath(), '.mcp.json');
	logError('Warning: MCP servers in agents.config.json are deprecated.');
	logError(`Please migrate to ${_configPath}. See documentation for details.`);
}

/**
 * Parse MCP servers from config object, supporting both array and object formats
 * Converts array format to normalized server list with deprecation warning
 */
function parseMCPServers(config: unknown): unknown[] | null {
	if (typeof config !== 'object' || config === null) {
		return null;
	}

	const configObj = config as Record<string, unknown>;
	let mcpServers: unknown[] | null = null;
	let usedArrayFormat = false;

	// Direct array format at root
	if (Array.isArray(config)) {
		mcpServers = config;
		usedArrayFormat = true;
	} else if (
		'nanocoder' in configObj &&
		configObj.nanocoder &&
		typeof configObj.nanocoder === 'object' &&
		'mcpServers' in configObj.nanocoder &&
		Array.isArray((configObj.nanocoder as Record<string, unknown>).mcpServers)
	) {
		mcpServers = (configObj.nanocoder as Record<string, unknown>)
			.mcpServers as unknown[];
		usedArrayFormat = true;
	} else if ('mcpServers' in configObj && Array.isArray(configObj.mcpServers)) {
		mcpServers = configObj.mcpServers;
		usedArrayFormat = true;
	} else if (
		'mcpServers' in configObj &&
		configObj.mcpServers &&
		typeof configObj.mcpServers === 'object' &&
		!Array.isArray(configObj.mcpServers)
	) {
		// Claude Code format: { "serverName": { ...serverConfig } }
		mcpServers = Object.entries(
			configObj.mcpServers as Record<string, unknown>,
		).map(([name, serverConfig]) => ({
			name,
			...(serverConfig as object),
		}));
	}

	// Show deprecation warning if array format was used
	if (usedArrayFormat && mcpServers && mcpServers.length > 0) {
		showArrayFormatDeprecationWarning();
	}

	return mcpServers;
}

/**
 * Load project-level MCP configuration from .mcp.json
 */
export function loadProjectMCPConfig(): MCPServerWithSource[] {
	const configPath = join(process.cwd(), '.mcp.json');

	if (!existsSync(configPath)) {
		return [];
	}

	try {
		const rawData = readFileSync(configPath, 'utf-8');
		const config = JSON.parse(rawData);

		const mcpServers = parseMCPServers(config);

		if (Array.isArray(mcpServers) && mcpServers.length > 0) {
			// Apply environment variable substitution
			const processedServers = substituteEnvVars(mcpServers);

			return processedServers.map((server: unknown) => {
				const typedServer = server as MCPServerConfig;
				return {
					server: {
						name: typedServer.name,
						transport: typedServer.transport,
						command: typedServer.command,
						args: typedServer.args,
						env: typedServer.env,
						url: typedServer.url,
						headers: typedServer.headers,
						auth: typedServer.auth,
						timeout: typedServer.timeout,
						reconnect: typedServer.reconnect,
						description: typedServer.description,
						tags: typedServer.tags,
						enabled: typedServer.enabled,
					},
					source: 'project' as ConfigSource,
				};
			});
		}
	} catch (error) {
		logError(`Failed to load MCP config from ${configPath}: ${String(error)}`);
	}

	return [];
}

/**
 * Load global MCP configuration from ~/.config/nanocoder/.mcp.json
 * Falls back to agents.config.json with deprecation warning
 */
export function loadGlobalMCPConfig(): MCPServerWithSource[] {
	const configDir = getConfigPath();
	const newConfigPath = join(configDir, '.mcp.json');

	// First, check the new .mcp.json location
	if (existsSync(newConfigPath)) {
		try {
			const rawData = readFileSync(newConfigPath, 'utf-8');
			const config = JSON.parse(rawData);

			const mcpServers = parseMCPServers(config);

			if (Array.isArray(mcpServers) && mcpServers.length > 0) {
				const processedServers = substituteEnvVars(mcpServers);

				return processedServers.map((server: unknown) => {
					const typedServer = server as MCPServerConfig;
					return {
						server: {
							name: typedServer.name,
							transport: typedServer.transport,
							command: typedServer.command,
							args: typedServer.args,
							env: typedServer.env,
							url: typedServer.url,
							headers: typedServer.headers,
							auth: typedServer.auth,
							timeout: typedServer.timeout,
							reconnect: typedServer.reconnect,
							description: typedServer.description,
							tags: typedServer.tags,
							enabled: typedServer.enabled,
						},
						source: 'global' as ConfigSource,
					};
				});
			}
		} catch (error) {
			logError(
				`Failed to load MCP config from ${newConfigPath}: ${String(error)}`,
			);
		}

		return [];
	}

	// Fallback to legacy agents.config.json with deprecation warning
	const homePath = join(homedir(), '.agents.config.json');
	if (existsSync(homePath)) {
		return loadMCPConfigFromAgentsConfig(homePath);
	}

	const legacyConfigPath = join(configDir, 'agents.config.json');
	if (existsSync(legacyConfigPath)) {
		return loadMCPConfigFromAgentsConfig(legacyConfigPath);
	}

	return [];
}

/**
 * Load MCP config from legacy agents.config.json with deprecation warning
 */
function loadMCPConfigFromAgentsConfig(
	filePath: string,
): MCPServerWithSource[] {
	try {
		const rawData = readFileSync(filePath, 'utf-8');
		const config = JSON.parse(rawData);

		let mcpServers: unknown[] | null = null;
		let hasMcpServers = false;

		if (config.nanocoder && Array.isArray(config.nanocoder.mcpServers)) {
			mcpServers = config.nanocoder.mcpServers;
			hasMcpServers = mcpServers !== null && mcpServers.length > 0;
		} else if (
			config.nanocoder &&
			config.nanocoder.mcpServers &&
			typeof config.nanocoder.mcpServers === 'object' &&
			!Array.isArray(config.nanocoder.mcpServers)
		) {
			// Claude Code format in agents.config.json
			mcpServers = Object.entries(
				config.nanocoder.mcpServers as Record<string, unknown>,
			).map(([name, serverConfig]) => ({
				name,
				...(serverConfig as object),
			}));
			hasMcpServers = mcpServers && mcpServers.length > 0;
		}

		// Show deprecation warning if MCP servers found in agents.config.json
		if (hasMcpServers) {
			showAgentsConfigDeprecationWarning();
		}

		if (Array.isArray(mcpServers) && mcpServers.length > 0) {
			const processedServers = substituteEnvVars(mcpServers);

			return processedServers.map((server: unknown) => {
				const typedServer = server as MCPServerConfig;
				return {
					server: {
						name: typedServer.name,
						transport: typedServer.transport,
						command: typedServer.command,
						args: typedServer.args,
						env: typedServer.env,
						url: typedServer.url,
						headers: typedServer.headers,
						auth: typedServer.auth,
						timeout: typedServer.timeout,
						reconnect: typedServer.reconnect,
						description: typedServer.description,
						tags: typedServer.tags,
						enabled: typedServer.enabled,
					},
					source: 'global' as ConfigSource,
				};
			});
		}
	} catch (error) {
		logError(`Failed to load MCP config from ${filePath}: ${String(error)}`);
	}

	return [];
}

/**
 * Merge project-level and global MCP configurations
 * ALL servers from both locations are loaded (project servers shown first)
 * No overriding - each unique server is preserved
 */
export function mergeMCPConfigs(
	projectServers: MCPServerWithSource[],
	globalServers: MCPServerWithSource[],
): MCPServerWithSource[] {
	const serverMap = new Map<string, MCPServerWithSource>();

	// Add project servers first (displayed first in UI)
	for (const projectServer of projectServers) {
		serverMap.set(projectServer.server.name, projectServer);
	}

	// Add global servers (only if not already added from project)
	for (const globalServer of globalServers) {
		if (!serverMap.has(globalServer.server.name)) {
			serverMap.set(globalServer.server.name, globalServer);
		}
	}

	return Array.from(serverMap.values());
}

/**
 * Load all MCP configurations with proper hierarchy and merging
 */
export function loadAllMCPConfigs(): MCPServerWithSource[] {
	const projectServers = loadProjectMCPConfig();
	// Skip loading global servers in test environment to allow test isolation
	const globalServers =
		process.env.NODE_ENV === 'test' ? [] : loadGlobalMCPConfig();

	return mergeMCPConfigs(projectServers, globalServers);
}

/**
 * Load provider configurations from all available levels (project and global)
 * This mirrors the approach used for MCP servers to support hierarchical loading
 */
export function loadAllProviderConfigs(): ProviderConfig[] {
	const projectProviders = loadProjectProviderConfigs();
	// Skip loading global providers in test environment to allow test isolation
	const globalProviders =
		process.env.NODE_ENV === 'test' ? [] : loadGlobalProviderConfigs();

	// Merge providers with project providers taking precedence over global ones
	// If a provider with the same name exists in both, project version wins
	const providerMap = new Map<string, ProviderConfig>();

	// Add global providers first (lower priority)
	for (const provider of globalProviders) {
		providerMap.set(provider.name, provider);
	}

	// Add project providers (higher priority) - they will override global ones
	for (const provider of projectProviders) {
		providerMap.set(provider.name, provider);
	}

	return Array.from(providerMap.values());
}

/**
 * Load provider configurations from project-level files
 */
function loadProjectProviderConfigs(): ProviderConfig[] {
	// Try to find provider configs in project-level config files
	const configPath = join(process.cwd(), 'agents.config.json');

	if (existsSync(configPath)) {
		try {
			const rawData = readFileSync(configPath, 'utf-8');
			const config = JSON.parse(rawData);

			if (config.nanocoder && Array.isArray(config.nanocoder.providers)) {
				// Apply environment variable substitution
				const processedProviders = substituteEnvVars(
					config.nanocoder.providers,
				);
				return processedProviders;
			} else if (Array.isArray(config.providers)) {
				// Apply environment variable substitution
				const processedProviders = substituteEnvVars(config.providers);
				return processedProviders;
			}
		} catch (error) {
			logError(
				`Failed to load project provider config from ${configPath}: ${String(error)}`,
			);
		}
	}

	return [];
}

/**
 * Load provider configurations from global config files using the same path resolution as the original system
 */
function loadGlobalProviderConfigs(): ProviderConfig[] {
	// Use the same path resolution logic as getClosestConfigFile
	const configDir = getConfigPath();

	// Check the $HOME for a hidden file. This should only be for legacy support
	const homePath = join(homedir(), '.agents.config.json');
	if (existsSync(homePath)) {
		const providers = loadProviderConfigFromFile(homePath);
		if (providers.length > 0) {
			return providers;
		}
	}

	// Next, lets look for a user level config.
	const configPath = join(configDir, 'agents.config.json');
	if (existsSync(configPath)) {
		return loadProviderConfigFromFile(configPath);
	}

	// Note: We don't check CWD here as that's handled by project-level loading
	return [];
}

// Helper function to load provider config from a specific file
function loadProviderConfigFromFile(filePath: string): ProviderConfig[] {
	try {
		const rawData = readFileSync(filePath, 'utf-8');
		const config = JSON.parse(rawData);

		if (config.nanocoder && Array.isArray(config.nanocoder.providers)) {
			// Apply environment variable substitution
			const processedProviders = substituteEnvVars(config.nanocoder.providers);
			return processedProviders;
		} else if (Array.isArray(config.providers)) {
			// Apply environment variable substitution
			const processedProviders = substituteEnvVars(config.providers);
			return processedProviders;
		}
	} catch (error) {
		logError(
			`Failed to load provider config from ${filePath}: ${String(error)}`,
		);
	}

	return [];
}
