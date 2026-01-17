import React from 'react';
import {createLLMClient} from '@/client-factory';
import {ErrorMessage, SuccessMessage} from '@/components/message-box';
import {reloadAppConfig} from '@/config/index';
import {
	loadPreferences,
	savePreferences,
	updateLastUsed,
	updateNanocoderShape,
	updateTitleShape,
} from '@/config/preferences';
import {getToolManager} from '@/message-handler';
import {LLMClient, Message} from '@/types/core';
import type {NanocoderShape, ThemePreset, TitleShape} from '@/types/ui';

interface UseModeHandlersProps {
	client: LLMClient | null;
	currentModel: string;
	currentProvider: string;
	currentTheme: ThemePreset;
	setClient: (client: LLMClient | null) => void;
	setCurrentModel: (model: string) => void;
	setCurrentProvider: (provider: string) => void;
	setCurrentTheme: (theme: ThemePreset) => void;
	setMessages: (messages: Message[]) => void;
	setIsModelSelectionMode: (mode: boolean) => void;
	setIsProviderSelectionMode: (mode: boolean) => void;
	setIsThemeSelectionMode: (mode: boolean) => void;
	setIsTitleShapeSelectionMode: (mode: boolean) => void;
	setIsNanocoderShapeSelectionMode: (mode: boolean) => void;
	setIsModelDatabaseMode: (mode: boolean) => void;
	setIsConfigWizardMode: (mode: boolean) => void;
	setIsMcpWizardMode: (mode: boolean) => void;
	addToChatQueue: (component: React.ReactNode) => void;
	getNextComponentKey: () => number;
	reinitializeMCPServers: (
		toolManager: import('@/tools/tool-manager').ToolManager,
	) => Promise<void>;
}

export function useModeHandlers({
	client,
	currentModel,
	currentProvider,
	currentTheme: _currentTheme,
	setClient,
	setCurrentModel,
	setCurrentProvider,
	setCurrentTheme,
	setMessages,
	setIsModelSelectionMode,
	setIsProviderSelectionMode,
	setIsThemeSelectionMode,
	setIsTitleShapeSelectionMode,
	setIsNanocoderShapeSelectionMode,
	setIsModelDatabaseMode,
	setIsConfigWizardMode,
	setIsMcpWizardMode,
	addToChatQueue,
	getNextComponentKey,
	reinitializeMCPServers,
}: UseModeHandlersProps) {
	// Helper function to enter model selection mode
	const enterModelSelectionMode = () => {
		setIsModelSelectionMode(true);
	};

	// Helper function to enter provider selection mode
	const enterProviderSelectionMode = () => {
		setIsProviderSelectionMode(true);
	};

	// Handle model selection
	const handleModelSelect = async (selectedModel: string) => {
		if (client && selectedModel !== currentModel) {
			client.setModel(selectedModel);
			setCurrentModel(selectedModel);

			// Clear message history when switching models
			setMessages([]);
			await client.clearContext();

			// Update preferences
			updateLastUsed(currentProvider, selectedModel);

			// Add success message to chat queue
			addToChatQueue(
				<SuccessMessage
					key={`model-changed-${getNextComponentKey()}`}
					message={`Model changed to: ${selectedModel}. Chat history cleared.`}
					hideBox={true}
				/>,
			);
		}
		setIsModelSelectionMode(false);
	};

	// Handle model selection cancel
	const handleModelSelectionCancel = () => {
		setIsModelSelectionMode(false);
	};

	// Handle provider selection
	const handleProviderSelect = async (selectedProvider: string) => {
		if (selectedProvider !== currentProvider) {
			try {
				// Create new client for the selected provider
				const {client: newClient, actualProvider} =
					await createLLMClient(selectedProvider);

				// Check if we got the provider we requested
				if (actualProvider !== selectedProvider) {
					// Provider was forced to a different one (likely due to missing config)
					addToChatQueue(
						<ErrorMessage
							key={`provider-forced-${getNextComponentKey()}`}
							message={`${selectedProvider} is not available. Please ensure it's properly configured in agents.config.json.`}
							hideBox={true}
						/>,
					);
					return; // Don't change anything
				}

				setClient(newClient);
				setCurrentProvider(actualProvider);

				// Set the model from the new client
				const newModel = newClient.getCurrentModel();
				setCurrentModel(newModel);

				// Clear message history when switching providers
				setMessages([]);
				await newClient.clearContext();

				// Update preferences - use the actualProvider (which is what was successfully created)
				updateLastUsed(actualProvider, newModel);

				// Add success message to chat queue
				addToChatQueue(
					<SuccessMessage
						key={`provider-changed-${getNextComponentKey()}`}
						message={`Provider changed to: ${actualProvider}, model: ${newModel}. Chat history cleared.`}
						hideBox={true}
					/>,
				);
			} catch (error) {
				// Add error message if provider change fails
				addToChatQueue(
					<ErrorMessage
						key={`provider-error-${getNextComponentKey()}`}
						message={`Failed to change provider to ${selectedProvider}: ${String(
							error,
						)}`}
						hideBox={true}
					/>,
				);
			}
		}
		setIsProviderSelectionMode(false);
	};

	// Handle provider selection cancel
	const handleProviderSelectionCancel = () => {
		setIsProviderSelectionMode(false);
	};

	// Helper function to enter theme selection mode
	const enterThemeSelectionMode = () => {
		setIsThemeSelectionMode(true);
	};

	// Helper function to enter title shape selection mode
	const enterTitleShapeSelectionMode = () => {
		setIsTitleShapeSelectionMode(true);
	};

	// Handle title shape selection
	const handleTitleShapeSelect = (selectedShape: TitleShape) => {
		updateTitleShape(selectedShape);

		// Add success message to chat queue
		addToChatQueue(
			<SuccessMessage
				key={`title-shape-changed-${getNextComponentKey()}`}
				message={`Title shape changed to: ${selectedShape}.`}
				hideBox={true}
			/>,
		);

		setIsTitleShapeSelectionMode(false);
	};

	// Handle title shape selection cancel
	const handleTitleShapeSelectionCancel = () => {
		setIsTitleShapeSelectionMode(false);
	};

	// Helper function to enter nanocoder shape selection mode
	const enterNanocoderShapeSelectionMode = () => {
		setIsNanocoderShapeSelectionMode(true);
	};

	// Handle nanocoder shape selection
	const handleNanocoderShapeSelect = (selectedShape: NanocoderShape) => {
		updateNanocoderShape(selectedShape);

		// Add success message to chat queue
		addToChatQueue(
			<SuccessMessage
				key={`nanocoder-shape-changed-${getNextComponentKey()}`}
				message={`Nanocoder branding style changed to: ${selectedShape}.`}
				hideBox={true}
			/>,
		);

		setIsNanocoderShapeSelectionMode(false);
	};

	// Handle nanocoder shape selection cancel
	const handleNanocoderShapeSelectionCancel = () => {
		setIsNanocoderShapeSelectionMode(false);
	};

	// Handle theme selection
	const handleThemeSelect = (selectedTheme: ThemePreset) => {
		const preferences = loadPreferences();
		preferences.selectedTheme = selectedTheme;
		savePreferences(preferences);

		// Update the theme state immediately for real-time switching
		setCurrentTheme(selectedTheme);

		// Add success message to chat queue
		addToChatQueue(
			<SuccessMessage
				key={`theme-changed-${getNextComponentKey()}`}
				message={`Theme changed to: ${selectedTheme}.`}
				hideBox={true}
			/>,
		);

		setIsThemeSelectionMode(false);
	};

	// Handle theme selection cancel
	const handleThemeSelectionCancel = () => {
		setIsThemeSelectionMode(false);
	};

	// Helper function to enter model database mode
	const enterModelDatabaseMode = () => {
		setIsModelDatabaseMode(true);
	};

	// Handle model database cancel
	const handleModelDatabaseCancel = () => {
		setIsModelDatabaseMode(false);
	};

	// Helper function to enter config wizard mode
	const enterConfigWizardMode = () => {
		setIsConfigWizardMode(true);
	};

	// Handle config wizard cancel/complete
	const handleConfigWizardComplete = async (configPath?: string) => {
		setIsConfigWizardMode(false);
		if (configPath) {
			addToChatQueue(
				<SuccessMessage
					key={`config-wizard-complete-${getNextComponentKey()}`}
					message={`Configuration saved to: ${configPath}.`}
					hideBox={true}
				/>,
			);

			// Reload the app configuration to pick up the newly saved config
			reloadAppConfig();

			// Reinitialize client with new configuration
			try {
				const preferences = loadPreferences();
				const {client: newClient, actualProvider} = await createLLMClient(
					preferences.lastProvider,
				);
				setClient(newClient);
				setCurrentProvider(actualProvider);

				const newModel = newClient.getCurrentModel();
				setCurrentModel(newModel);

				// Clear message history when switching providers
				setMessages([]);
				await newClient.clearContext();

				// Reinitialize MCP servers with the new configuration
				const toolManager = getToolManager();
				if (toolManager) {
					try {
						await reinitializeMCPServers(toolManager);
						addToChatQueue(
							<SuccessMessage
								key={`mcp-reinit-${getNextComponentKey()}`}
								message="MCP servers reinitialized with new configuration."
								hideBox={true}
							/>,
						);
					} catch (mcpError) {
						addToChatQueue(
							<ErrorMessage
								key={`mcp-reinit-error-${getNextComponentKey()}`}
								message={`Failed to reinitialize MCP servers: ${String(
									mcpError,
								)}`}
								hideBox={true}
							/>,
						);
					}
				}

				addToChatQueue(
					<SuccessMessage
						key={`config-init-${getNextComponentKey()}`}
						message={`Ready! Using provider: ${actualProvider}, model: ${newModel}`}
						hideBox={true}
					/>,
				);
			} catch (error) {
				addToChatQueue(
					<ErrorMessage
						key={`config-init-error-${getNextComponentKey()}`}
						message={`Failed to initialize with new configuration: ${String(
							error,
						)}`}
						hideBox={true}
					/>,
				);
			}
		}
	};

	const handleConfigWizardCancel = () => {
		setIsConfigWizardMode(false);
	};

	// Helper function to enter MCP wizard mode
	const enterMcpWizardMode = () => {
		setIsMcpWizardMode(true);
	};

	// Handle MCP wizard cancel/complete
	const handleMcpWizardComplete = async (configPath?: string) => {
		setIsMcpWizardMode(false);
		if (configPath) {
			addToChatQueue(
				<SuccessMessage
					key={`mcp-wizard-complete-${getNextComponentKey()}`}
					message={`MCP configuration saved to: ${configPath}.`}
					hideBox={true}
				/>,
			);

			// Reload the app configuration to pick up the newly saved config
			reloadAppConfig();

			// Reinitialize MCP servers with the new configuration
			const toolManager = getToolManager();
			if (toolManager) {
				try {
					await reinitializeMCPServers(toolManager);
					addToChatQueue(
						<SuccessMessage
							key={`mcp-reinit-${getNextComponentKey()}`}
							message="MCP servers reinitialized with new configuration."
							hideBox={true}
						/>,
					);
				} catch (mcpError) {
					addToChatQueue(
						<ErrorMessage
							key={`mcp-reinit-error-${getNextComponentKey()}`}
							message={`Failed to reinitialize MCP servers: ${String(
								mcpError,
							)}`}
							hideBox={true}
						/>,
					);
				}
			}
		}
	};

	const handleMcpWizardCancel = () => {
		setIsMcpWizardMode(false);
	};

	return {
		enterModelSelectionMode,
		enterProviderSelectionMode,
		enterThemeSelectionMode,
		enterTitleShapeSelectionMode,
		handleTitleShapeSelect,
		handleTitleShapeSelectionCancel,
		enterNanocoderShapeSelectionMode,
		handleNanocoderShapeSelect,
		handleNanocoderShapeSelectionCancel,
		enterModelDatabaseMode,
		enterConfigWizardMode,
		enterMcpWizardMode,
		handleModelSelect,
		handleModelSelectionCancel,
		handleProviderSelect,
		handleProviderSelectionCancel,
		handleThemeSelect,
		handleThemeSelectionCancel,
		handleModelDatabaseCancel,
		handleConfigWizardComplete,
		handleConfigWizardCancel,
		handleMcpWizardComplete,
		handleMcpWizardCancel,
	};
}
