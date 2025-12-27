import {createLLMClient} from '@/client-factory';
import {ErrorMessage, SuccessMessage} from '@/components/message-box';
import {reloadAppConfig} from '@/config/index';
import {
	loadPreferences,
	savePreferences,
	updateLastUsed,
} from '@/config/preferences';
import {getToolManager} from '@/message-handler';
import {LLMClient, Message} from '@/types/core';
import type {ThemePreset} from '@/types/ui';
import React from 'react';

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
	setIsModelDatabaseMode: (mode: boolean) => void;
	setIsConfigWizardMode: (mode: boolean) => void;
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
	setIsModelDatabaseMode,
	setIsConfigWizardMode,
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

	return {
		enterModelSelectionMode,
		enterProviderSelectionMode,
		enterThemeSelectionMode,
		enterModelDatabaseMode,
		enterConfigWizardMode,
		handleModelSelect,
		handleModelSelectionCancel,
		handleProviderSelect,
		handleProviderSelectionCancel,
		handleThemeSelect,
		handleThemeSelectionCancel,
		handleModelDatabaseCancel,
		handleConfigWizardComplete,
		handleConfigWizardCancel,
	};
}
