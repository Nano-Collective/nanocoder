import React from 'react';
import {createLLMClient} from '@/client-factory';
import {ErrorMessage, SuccessMessage} from '@/components/message-box';
import {reloadAppConfig} from '@/config/index';
import {loadPreferences, saveTune, updateLastUsed} from '@/config/preferences';
import type {ActiveMode} from '@/hooks/useAppState';
import {getToolManager} from '@/message-handler';
import type {TuneConfig} from '@/types/config';
import {LLMClient, Message} from '@/types/core';
import {
	setAutoCompactMode,
	setAutoCompactThreshold,
} from '@/utils/auto-compact';

interface UseModeHandlersProps {
	client: LLMClient | null;
	currentModel: string;
	currentProvider: string;
	setClient: (client: LLMClient | null) => void;
	setCurrentModel: (model: string) => void;
	setCurrentProvider: (provider: string) => void;
	setMessages: (messages: Message[]) => void;
	setActiveMode: (mode: ActiveMode) => void;
	setIsSettingsMode: (mode: boolean) => void;
	addToChatQueue: (component: React.ReactNode) => void;
	getNextComponentKey: () => number;
	reinitializeMCPServers: (
		toolManager: import('@/tools/tool-manager').ToolManager,
	) => Promise<void>;
	setTune: (config: TuneConfig) => void;
}

export function useModeHandlers({
	client,
	currentModel,
	currentProvider,
	setClient,
	setCurrentModel,
	setCurrentProvider,
	setMessages,
	setActiveMode,
	setIsSettingsMode,
	addToChatQueue,
	getNextComponentKey,
	reinitializeMCPServers,
	setTune,
}: UseModeHandlersProps) {
	// Generic enter/exit helpers
	const enterMode = (mode: ActiveMode) => setActiveMode(mode);
	const exitMode = () => setActiveMode(null);

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

			addToChatQueue(
				<SuccessMessage
					key={`model-changed-${getNextComponentKey()}`}
					message={`Model changed to: ${selectedModel}. Chat history cleared.`}
					hideBox={true}
				/>,
			);
		}
		exitMode();
	};

	// Handle provider selection
	const handleProviderSelect = async (selectedProvider: string) => {
		if (selectedProvider !== currentProvider) {
			try {
				const {client: newClient, actualProvider} =
					await createLLMClient(selectedProvider);

				if (actualProvider !== selectedProvider) {
					addToChatQueue(
						<ErrorMessage
							key={`provider-forced-${getNextComponentKey()}`}
							message={`${selectedProvider} is not available. Please ensure it's properly configured in agents.config.json.`}
							hideBox={true}
						/>,
					);
					return;
				}

				setClient(newClient);
				setCurrentProvider(actualProvider);

				const newModel = newClient.getCurrentModel();
				setCurrentModel(newModel);

				setMessages([]);
				await newClient.clearContext();

				updateLastUsed(actualProvider, newModel);

				addToChatQueue(
					<SuccessMessage
						key={`provider-changed-${getNextComponentKey()}`}
						message={`Provider changed to: ${actualProvider}, model: ${newModel}. Chat history cleared.`}
						hideBox={true}
					/>,
				);
			} catch (error) {
				addToChatQueue(
					<ErrorMessage
						key={`provider-error-${getNextComponentKey()}`}
						message={`Failed to change provider to ${selectedProvider}: ${String(error)}`}
						hideBox={true}
					/>,
				);
			}
		}
		exitMode();
	};

	// Handle config wizard complete - reinitializes client and MCP servers
	const handleConfigWizardComplete = async (configPath?: string) => {
		exitMode();
		if (configPath) {
			addToChatQueue(
				<SuccessMessage
					key={`config-wizard-complete-${getNextComponentKey()}`}
					message={`Configuration saved to: ${configPath}.`}
					hideBox={true}
				/>,
			);

			reloadAppConfig();

			try {
				const preferences = loadPreferences();
				const {client: newClient, actualProvider} = await createLLMClient(
					preferences.lastProvider,
				);
				setClient(newClient);
				setCurrentProvider(actualProvider);

				const newModel = newClient.getCurrentModel();
				setCurrentModel(newModel);

				setMessages([]);
				await newClient.clearContext();

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
								message={`Failed to reinitialize MCP servers: ${String(mcpError)}`}
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
						message={`Failed to initialize with new configuration: ${String(error)}`}
						hideBox={true}
					/>,
				);
			}
		}
	};

	// Handle MCP wizard complete - reinitializes MCP servers
	const handleMcpWizardComplete = async (configPath?: string) => {
		exitMode();
		if (configPath) {
			addToChatQueue(
				<SuccessMessage
					key={`mcp-wizard-complete-${getNextComponentKey()}`}
					message={`MCP configuration saved to: ${configPath}.`}
					hideBox={true}
				/>,
			);

			reloadAppConfig();

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
							message={`Failed to reinitialize MCP servers: ${String(mcpError)}`}
							hideBox={true}
						/>,
					);
				}
			}
		}
	};

	// Handle model mode selection
	const handleTuneSelect = async (config: TuneConfig) => {
		setTune(config);
		saveTune(config);

		// Apply/remove auto-compact session overrides
		if (config.enabled && config.aggressiveCompact) {
			setAutoCompactThreshold(40);
			setAutoCompactMode('aggressive');
		} else {
			setAutoCompactThreshold(null);
			setAutoCompactMode(null);
		}

		// Clear conversation when toggling — tool profiles change what's available
		setMessages([]);
		if (client) {
			await client.clearContext();
		}

		const parts: string[] = [];
		if (config.enabled) {
			parts.push(`profile: ${config.toolProfile}`);
			if (config.aggressiveCompact) parts.push('aggressive compact');
			addToChatQueue(
				<SuccessMessage
					key={`tune-${getNextComponentKey()}`}
					message={`Tune enabled (${parts.join(', ')}). Chat history cleared.`}
					hideBox={true}
				/>,
			);
		} else {
			addToChatQueue(
				<SuccessMessage
					key={`tune-${getNextComponentKey()}`}
					message="Tune disabled. Chat history cleared."
					hideBox={true}
				/>,
			);
		}

		exitMode();
	};

	return {
		enterMode,
		exitMode,
		// Convenience enter helpers
		enterModelSelectionMode: () => enterMode('model'),
		enterProviderSelectionMode: () => enterMode('provider'),
		enterModelDatabaseMode: () => enterMode('modelDatabase'),
		enterConfigWizardMode: () => enterMode('configWizard'),
		enterMcpWizardMode: () => enterMode('mcpWizard'),
		enterExplorerMode: () => enterMode('explorer'),
		enterIdeSelectionMode: () => enterMode('ideSelection'),
		enterSettingsMode: () => setIsSettingsMode(true),
		// Cancel/complete handlers
		handleModelSelect,
		handleModelSelectionCancel: exitMode,
		handleProviderSelect,
		handleProviderSelectionCancel: exitMode,
		handleModelDatabaseCancel: exitMode,
		handleConfigWizardComplete,
		handleConfigWizardCancel: exitMode,
		handleMcpWizardComplete,
		handleMcpWizardCancel: exitMode,
		handleSettingsCancel: () => setIsSettingsMode(false),
		handleExplorerCancel: exitMode,
		handleIdeSelectionCancel: exitMode,
		// Model mode
		enterTune: () => enterMode('tune'),
		handleTuneSelect,
		handleTuneCancel: exitMode,
	};
}
