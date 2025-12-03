import React, {useEffect} from 'react';
import {LLMClient} from '@/types/core';
import {ToolManager} from '@/tools/tool-manager';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import {createLLMClient, ConfigurationError} from '@/client-factory';
import {
	getLastUsedModel,
	loadPreferences,
	updateLastUsed,
} from '@/config/preferences';
import type {MCPInitResult, UserPreferences} from '@/types/index';
import type {CustomCommand} from '@/types/commands';
import type {MCPConnectionStatus} from '@/types/mcp';
import type {LSPConnectionStatus} from '@/lsp/lsp-manager';
import {setToolManagerGetter, setToolRegistryGetter} from '@/message-handler';
import {commandRegistry} from '@/commands';
import {appConfig, reloadAppConfig} from '@/config/index';
import {getLSPManager, type LSPInitResult} from '@/lsp/index';
import {
	clearCommand,
	commandsCommand,
	exitCommand,
	exportCommand,
	helpCommand,
	initCommand,
	lspCommand,
	mcpCommand,
	modelCommand,
	providerCommand,
	recommendationsCommand,
	setupConfigCommand,
	statusCommand,
	streamingCommand,
	themeCommand,
	updateCommand,
	usageCommand,
} from '@/commands/index';
import SuccessMessage from '@/components/success-message';
import ErrorMessage from '@/components/error-message';
import InfoMessage from '@/components/info-message';
import {checkForUpdates} from '@/utils/update-checker';
import type {UpdateInfo} from '@/types/index';

interface UseAppInitializationProps {
	setClient: (client: LLMClient | null) => void;
	setCurrentModel: (model: string) => void;
	setCurrentProvider: (provider: string) => void;
	setToolManager: (manager: ToolManager | null) => void;
	setCustomCommandLoader: (loader: CustomCommandLoader | null) => void;
	setCustomCommandExecutor: (executor: CustomCommandExecutor | null) => void;
	setCustomCommandCache: (cache: Map<string, CustomCommand>) => void;
	setStartChat: (start: boolean) => void;
	setMcpInitialized: (initialized: boolean) => void;
	setUpdateInfo: (info: UpdateInfo | null) => void;
	setMcpConnectionStatus: (status: MCPConnectionStatus) => void;
	setLspConnectionStatus: (status: LSPConnectionStatus) => void;
	addToChatQueue: (component: React.ReactNode) => void;
	componentKeyCounter: number;
	customCommandCache: Map<string, CustomCommand>;
	setIsConfigWizardMode: (mode: boolean) => void;
}

export function useAppInitialization({
	setClient,
	setCurrentModel,
	setCurrentProvider,
	setToolManager,
	setCustomCommandLoader,
	setCustomCommandExecutor,
	setCustomCommandCache: _setCustomCommandCache,
	setStartChat,
	setMcpInitialized,
	setUpdateInfo,
	setMcpConnectionStatus,
	setLspConnectionStatus,
	addToChatQueue,
	componentKeyCounter,
	customCommandCache,
	setIsConfigWizardMode,
}: UseAppInitializationProps) {
	// Initialize LLM client and model
	const initializeClient = async (preferredProvider?: string) => {
		const {client, actualProvider} = await createLLMClient(preferredProvider);
		setClient(client);
		setCurrentProvider(actualProvider);

		// Try to use the last used model for this provider
		const lastUsedModel = getLastUsedModel(actualProvider);

		let finalModel: string;
		if (lastUsedModel) {
			const availableModels = await client.getAvailableModels();
			if (availableModels.includes(lastUsedModel)) {
				client.setModel(lastUsedModel);
				finalModel = lastUsedModel;
			} else {
				finalModel = client.getCurrentModel();
			}
		} else {
			finalModel = client.getCurrentModel();
		}

		setCurrentModel(finalModel);

		// Save the preference - use actualProvider and the model that was actually set
		updateLastUsed(actualProvider, finalModel);
	};

	// Load and cache custom commands
	const loadCustomCommands = (loader: CustomCommandLoader) => {
		loader.loadCommands();
		const customCommands = loader.getAllCommands() || [];

		// Populate command cache for better performance
		customCommandCache.clear();
		for (const command of customCommands) {
			customCommandCache.set(command.name, command);
			// Also cache aliases for quick lookup
			if (command.metadata?.aliases) {
				for (const alias of command.metadata.aliases) {
					customCommandCache.set(alias, command);
				}
			}
		}

		if (customCommands.length > 0) {
			addToChatQueue(
				<SuccessMessage
					key={`custom-commands-loaded-${componentKeyCounter}`}
					message={`Loaded ${customCommands.length} custom commands from .nanocoder/commands...`}
					hideBox={true}
				/>,
			);
		}
	};

	// Initialize MCP servers if configured
	const initializeMCPServers = async (toolManager: ToolManager) => {
		if (appConfig.mcpServers && appConfig.mcpServers.length > 0) {
			// Initialize connection status
			const initialStatus: MCPConnectionStatus = {
				totalCount: appConfig.mcpServers.length,
				connectedCount: 0,
				errorCount: 0,
				servers: appConfig.mcpServers.map(server => ({
					name: server.name,
					connected: false,
					toolCount: 0,
					error: undefined,
				})),
			};
			setMcpConnectionStatus(initialStatus);

			// Track current server states dynamically
			const serverStates = new Map<string, { connected: boolean; toolCount: number; error?: string }>();

			// Initialize all server states
			for (const server of appConfig.mcpServers) {
				serverStates.set(server.name, { connected: false, toolCount: 0, error: undefined });
			}

			// Define progress callback to update status in real-time
			const onProgress = (result: MCPInitResult) => {
				// Update the server state
				serverStates.set(result.serverName, {
					connected: result.success,
					toolCount: result.toolCount || 0,
					error: result.error,
				});

				// Calculate current status from all servers
				const currentServers = Array.from(serverStates.entries()).map(([name, state]) => ({
					name,
					connected: state.connected,
					toolCount: state.toolCount,
					error: state.error,
				}));

				const connectedCount = currentServers.filter(s => s.connected).length;
				const errorCount = currentServers.filter(s => !s.connected && s.error).length;

				// Update status immediately
				setMcpConnectionStatus({
					totalCount: currentServers.length,
					connectedCount,
					errorCount,
					servers: currentServers,
				});
			};

			try {
				await toolManager.initializeMCP(appConfig.mcpServers, onProgress);
			} catch (error) {
				// Update all servers to error state if initialization fails catastrophically
				for (const [serverName] of serverStates) {
					serverStates.set(serverName, {
						connected: false,
						toolCount: 0,
						error: `Initialization failed: ${String(error)}`,
					});
				}

				const errorServers = Array.from(serverStates.entries()).map(([name, state]) => ({
					name,
					connected: state.connected,
					toolCount: state.toolCount,
					error: state.error,
				}));

				setMcpConnectionStatus({
					totalCount: errorServers.length,
					connectedCount: 0,
					errorCount: errorServers.length,
					servers: errorServers,
				});
			}
			// Mark MCP as initialized whether successful or not
			setMcpInitialized(true);
		} else {
			// No MCP servers configured, set empty status
			setMcpConnectionStatus({
				totalCount: 0,
				connectedCount: 0,
				errorCount: 0,
				servers: [],
			});
			setMcpInitialized(true);
		}
	};

	// Initialize LSP servers with auto-discovery
	const initializeLSPServers = async () => {
		const lspManager = getLSPManager({
			rootUri: `file://${process.cwd()}`,
			autoDiscover: true,
			// Use custom servers from config if provided
			servers: appConfig.lspServers?.map(server => ({
				name: server.name,
				command: server.command,
				args: server.args,
				languages: server.languages,
				env: server.env,
			})),
		});

		// Initialize with empty status - we don't know the total count yet due to auto-discovery
		setLspConnectionStatus({
			totalCount: 0,
			connectedCount: 0,
			errorCount: 0,
			servers: [],
		});

		// Track current server states dynamically
		const serverStates = new Map<string, { connected: boolean; languages?: string[]; error?: string }>();

		// Define progress callback to update status in real-time
		const onProgress = (result: LSPInitResult) => {
			// Update the server state
			serverStates.set(result.serverName, {
				connected: result.success,
				languages: result.languages,
				error: result.error,
			});

			// Calculate current status from all servers
			const currentServers = Array.from(serverStates.entries()).map(([name, state]) => ({
				name,
				connected: state.connected,
				languages: state.languages,
				error: state.error,
			}));

			const connectedCount = currentServers.filter(s => s.connected).length;
			const errorCount = currentServers.filter(s => !s.connected && s.error).length;

			// Update status immediately
			setLspConnectionStatus({
				totalCount: currentServers.length,
				connectedCount,
				errorCount,
				servers: currentServers,
			});
		};

		try {
			await lspManager.initialize({
				autoDiscover: true,
				servers: appConfig.lspServers?.map(server => ({
					name: server.name,
					command: server.command,
					args: server.args,
					languages: server.languages,
					env: server.env,
				})),
				onProgress,
			});

			// Ensure final LSP status is set after initialization completes
			const finalServers = Array.from(serverStates.entries()).map(([name, state]) => ({
				name,
				connected: state.connected,
				languages: state.languages,
				error: state.error,
			}));

			const connectedCount = finalServers.filter(s => s.connected).length;
			const errorCount = finalServers.filter(s => !s.connected && s.error).length;

			setLspConnectionStatus({
				totalCount: finalServers.length,
				connectedCount,
				errorCount,
				servers: finalServers,
			});
		} catch (error) {
			// Update all servers to error state if initialization fails catastrophically
			for (const [serverName] of serverStates) {
				serverStates.set(serverName, {
					connected: false,
					languages: undefined,
					error: `Initialization failed: ${String(error)}`,
				});
			}

			const errorServers = Array.from(serverStates.entries()).map(([name, state]) => ({
				name,
				connected: state.connected,
				languages: state.languages,
				error: state.error,
			}));

			setLspConnectionStatus({
				totalCount: errorServers.length,
				connectedCount: 0,
				errorCount: errorServers.length,
				servers: errorServers,
			});
			console.error('LSP initialization error:', error);
		}
	};

	const start = async (
		newToolManager: ToolManager,
		newCustomCommandLoader: CustomCommandLoader,
		preferences: UserPreferences,
	): Promise<void> => {
		try {
			await initializeClient(preferences.lastProvider);
		} catch (error) {
			// Check if it's a ConfigurationError - launch wizard for any config issue
			if (error instanceof ConfigurationError) {
				addToChatQueue(
					<InfoMessage
						key={`config-error-${componentKeyCounter}`}
						message="Configuration needed. Let's set up your providers..."
						hideBox={true}
					/>,
				);
				// Trigger wizard mode after showing UI
				setTimeout(() => {
					setIsConfigWizardMode(true);
				}, 100);
			} else {
				// Regular error - show simple error message
				addToChatQueue(
					<ErrorMessage
						key={`init-error-${componentKeyCounter}`}
						message={`No providers available: ${String(error)}`}
						hideBox={true}
					/>,
				);
			}
			// Leave client as null - the UI will handle this gracefully
		}

		try {
			loadCustomCommands(newCustomCommandLoader);
		} catch (error) {
			addToChatQueue(
				<ErrorMessage
					key={`commands-error-${componentKeyCounter}`}
					message={`Failed to load custom commands: ${String(error)}`}
					hideBox={true}
				/>,
			);
		}
	};

	useEffect(() => {
		const initializeApp = async () => {
			setClient(null);
			setCurrentModel('');

			const newToolManager = new ToolManager();
			const newCustomCommandLoader = new CustomCommandLoader();
			const newCustomCommandExecutor = new CustomCommandExecutor();

			setToolManager(newToolManager);
			setCustomCommandLoader(newCustomCommandLoader);
			setCustomCommandExecutor(newCustomCommandExecutor);

			// Load preferences - we'll pass them directly to avoid state timing issues
			const preferences = loadPreferences();

			// Add info message to chat queue when preferences are loaded
			addToChatQueue(
				<SuccessMessage
					key="preferences-loaded"
					message="User preferences loaded..."
					hideBox={true}
				/>,
			);

			// Set up the tool registry getter for the message handler
			setToolRegistryGetter(() => newToolManager.getToolRegistry());

			// Set up the tool manager getter for commands that need it
			setToolManagerGetter(() => newToolManager);

			commandRegistry.register([
				helpCommand,
				exitCommand,
				clearCommand,
				modelCommand,
				providerCommand,
				commandsCommand,
				lspCommand,
				mcpCommand,
				initCommand,
				themeCommand,
				exportCommand,
				updateCommand,
				recommendationsCommand,
				statusCommand,
				setupConfigCommand,
				streamingCommand,
				usageCommand,
			]);

			// Now start with the properly initialized objects (excluding MCP)
			await start(newToolManager, newCustomCommandLoader, preferences);

			// Check for updates before showing UI
			try {
				const info = await checkForUpdates();
				setUpdateInfo(info);
			} catch {
				// Silent failure - don't show errors for update checks
				setUpdateInfo(null);
			}

			setStartChat(true);

			// Initialize MCP servers after UI is shown
			await initializeMCPServers(newToolManager);

			// Initialize LSP servers with auto-discovery
			await initializeLSPServers();
		};

		void initializeApp();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return {
		initializeClient,
		loadCustomCommands,
		initializeMCPServers,
		reinitializeMCPServers: async (toolManager: ToolManager) => {
			// Reload app config to get latest MCP servers
			reloadAppConfig();
			// Reinitialize MCP servers with new configuration
			await initializeMCPServers(toolManager);
		},
		initializeLSPServers,
	};
}
