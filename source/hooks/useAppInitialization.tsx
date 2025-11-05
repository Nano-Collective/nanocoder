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
import {setToolManagerGetter, setToolRegistryGetter} from '@/message-handler';
import {commandRegistry} from '@/commands';
import {appConfig} from '@/config/index';
import {
	clearCommand,
	commandsCommand,
	exitCommand,
	exportCommand,
	helpCommand,
	initCommand,
	mcpCommand,
	modelCommand,
	providerCommand,
	recommendationsCommand,
	resumeCommand,
	setupConfigCommand,
	statusCommand,
	themeCommand,
	updateCommand,
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
			// Add connecting message to chat queue
			addToChatQueue(
				<InfoMessage
					key={`mcp-connecting-${componentKeyCounter}`}
					message={`Connecting to ${appConfig.mcpServers.length} MCP server${
						appConfig.mcpServers.length > 1 ? 's' : ''
					}...`}
					hideBox={true}
				/>,
			);

			// Define progress callback to show live updates
			const onProgress = (result: MCPInitResult) => {
				if (result.success) {
					addToChatQueue(
						<SuccessMessage
							key={`mcp-success-${result.serverName}-${componentKeyCounter}`}
							message={`Connected to MCP server "${result.serverName}" with ${result.toolCount} tools`}
							hideBox={true}
						/>,
					);
				} else {
					addToChatQueue(
						<ErrorMessage
							key={`mcp-error-${result.serverName}-${componentKeyCounter}`}
							message={`Failed to connect to MCP server "${result.serverName}": ${result.error}`}
							hideBox={true}
						/>,
					);
				}
			};

			try {
				await toolManager.initializeMCP(appConfig.mcpServers, onProgress);
			} catch (error) {
				addToChatQueue(
					<ErrorMessage
						key={`mcp-fatal-error-${componentKeyCounter}`}
						message={`Failed to initialize MCP servers: ${String(error)}`}
						hideBox={true}
					/>,
				);
			}
			// Mark MCP as initialized whether successful or not
			setMcpInitialized(true);
		} else {
			// No MCP servers configured, mark as initialized immediately
			setMcpInitialized(true);
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
				mcpCommand,
				initCommand,
				themeCommand,
				exportCommand,
				updateCommand,
				recommendationsCommand,
				resumeCommand,
				statusCommand,
				setupConfigCommand,
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
		};

		void initializeApp();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return {
		initializeClient,
		loadCustomCommands,
		initializeMCPServers,
	};
}
