import React, {useEffect} from 'react';
import {ConfigurationError, createLLMClient} from '@/client-factory';
import {commandRegistry} from '@/commands';
import {
	checkpointCommand,
	clearCommand,
	commandsCommand,
	compactCommand,
	exitCommand,
	exportCommand,
	helpCommand,
	initCommand,
	lspCommand,
	mcpCommand,
	modelCommand,
	modelDatabaseCommand,
	nanocoderShapeCommand,
	providerCommand,
	quitCommand,
	settingsCommand,
	setupMcpCommand,
	setupProvidersCommand,
	statusCommand,
	themeCommand,
	titleShapeCommand,
	updateCommand,
	usageCommand,
} from '@/commands/index';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import {appConfig, reloadAppConfig} from '@/config/index';
import {
	getLastUsedModel,
	loadPreferences,
	updateLastUsed,
} from '@/config/preferences';
import {validateProjectConfigSecurity} from '@/config/validation';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {getLSPManager, type LSPInitResult} from '@/lsp/index';
import {setToolManagerGetter, setToolRegistryGetter} from '@/message-handler';
import {ToolManager} from '@/tools/tool-manager';
import type {CustomCommand} from '@/types/commands';
import {
	LLMClient,
	LSPConnectionStatus,
	MCPConnectionStatus,
} from '@/types/core';
import type {MCPInitResult, UpdateInfo, UserPreferences} from '@/types/index';
import {checkForUpdates} from '@/utils/update-checker';

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
	setMcpServersStatus: (status: MCPConnectionStatus[]) => void;
	setLspServersStatus: (status: LSPConnectionStatus[]) => void;
	setPreferencesLoaded: (loaded: boolean) => void;
	setCustomCommandsCount: (count: number) => void;
	addToChatQueue: (component: React.ReactNode) => void;
	getNextComponentKey: () => number;
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
	setMcpServersStatus,
	setLspServersStatus,
	setPreferencesLoaded,
	setCustomCommandsCount,
	addToChatQueue,
	getNextComponentKey,
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

		// Set the count for display in Status component
		setCustomCommandsCount(customCommands.length);
	};

	// Initialize MCP servers if configured
	const initializeMCPServers = async (toolManager: ToolManager) => {
		if (appConfig.mcpServers && appConfig.mcpServers.length > 0) {
			// Validate security for project-level configurations
			validateProjectConfigSecurity(appConfig.mcpServers);

			// Initialize status array
			const mcpStatus: MCPConnectionStatus[] = appConfig.mcpServers.map(
				server => ({
					name: server.name,
					status: 'pending' as const,
				}),
			);

			// Define progress callback to update status silently
			const onProgress = (result: MCPInitResult) => {
				const statusIndex = mcpStatus.findIndex(
					s => s.name === result.serverName,
				);
				if (statusIndex !== -1) {
					if (result.success) {
						mcpStatus[statusIndex] = {
							name: result.serverName,
							status: 'connected',
						};
					} else {
						mcpStatus[statusIndex] = {
							name: result.serverName,
							status: 'failed',
							errorMessage: result.error,
						};
					}
					// Update the state with current status
					setMcpServersStatus([...mcpStatus]);
				}
			};

			try {
				await toolManager.initializeMCP(appConfig.mcpServers, onProgress);
			} catch (error) {
				// Mark all pending servers as failed
				mcpStatus.forEach((status, index) => {
					if (status.status === 'pending') {
						mcpStatus[index] = {
							...status,
							status: 'failed',
							errorMessage: String(error),
						};
					}
				});
				setMcpServersStatus([...mcpStatus]);
			}
			// Mark MCP as initialized whether successful or not
			setMcpInitialized(true);
		} else {
			// No MCP servers configured, set empty status
			setMcpServersStatus([]);
			setMcpInitialized(true);
		}
	};

	// Initialize LSP servers with auto-discovery
	const initializeLSPServers = async () => {
		const lspManager = await getLSPManager({
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

		// Initialize status array for configured servers
		const lspStatus: LSPConnectionStatus[] = [];

		// Add configured servers to status
		if (appConfig.lspServers) {
			for (const server of appConfig.lspServers) {
				lspStatus.push({
					name: server.name,
					status: 'pending',
				});
			}
		}

		// Define progress callback to update status silently
		const onProgress = (result: LSPInitResult) => {
			const statusIndex = lspStatus.findIndex(
				s => s.name === result.serverName,
			);
			if (statusIndex !== -1) {
				if (result.success) {
					lspStatus[statusIndex] = {
						name: result.serverName,
						status: 'connected',
					};
				} else {
					// Don't mark auto-discovery failures as errors
					lspStatus[statusIndex] = {
						name: result.serverName,
						status: 'failed',
						errorMessage: result.error,
					};
				}
				// Update the state with current status
				setLspServersStatus([...lspStatus]);
			}
			// For auto-discovered servers, add them if successful
			else if (result.success) {
				lspStatus.push({
					name: result.serverName,
					status: 'connected',
				});
				setLspServersStatus([...lspStatus]);
			}
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

			// Mark any remaining pending servers as failed
			lspStatus.forEach((status, index) => {
				if (status.status === 'pending') {
					lspStatus[index] = {
						...status,
						status: 'failed',
						errorMessage: 'Connection timeout',
					};
				}
			});
			setLspServersStatus([...lspStatus]);
		} catch (error) {
			// Mark all pending servers as failed
			lspStatus.forEach((status, index) => {
				if (status.status === 'pending') {
					lspStatus[index] = {
						...status,
						status: 'failed',
						errorMessage: String(error),
					};
				}
			});
			setLspServersStatus([...lspStatus]);
		}
	};

	const start = async (
		_newToolManager: ToolManager,
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
						key={`config-error-${getNextComponentKey()}`}
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
						key={`init-error-${getNextComponentKey()}`}
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
					key={`commands-error-${getNextComponentKey()}`}
					message={`Failed to load custom commands: ${String(error)}`}
					hideBox={true}
				/>,
			);
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: Initialization effect should only run once on mount
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

			// Mark preferences as loaded for display in Status component
			setPreferencesLoaded(true);

			// Set up the tool registry getter for the message handler
			setToolRegistryGetter(() => newToolManager.getToolRegistry());

			// Set up the tool manager getter for commands that need it
			setToolManagerGetter(() => newToolManager);

			commandRegistry.register([
				helpCommand,
				exitCommand,
				clearCommand,
				compactCommand,
				modelCommand,
				providerCommand,
				commandsCommand,
				lspCommand,
				mcpCommand,
				initCommand,
				themeCommand,
				exportCommand,
				updateCommand,
				modelDatabaseCommand,
				statusCommand,
				setupProvidersCommand,
				setupMcpCommand,
				usageCommand,
				titleShapeCommand,
				nanocoderShapeCommand,
				checkpointCommand,
				quitCommand,
				settingsCommand,
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

			// Initialize MCP servers before showing UI
			await initializeMCPServers(newToolManager);

			// Initialize LSP servers with auto-discovery
			await initializeLSPServers();

			// Show chat UI after all servers are initialized
			setStartChat(true);
		};

		void initializeApp();
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
