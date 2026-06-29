import React from 'react';
import {createLLMClient} from '@/client-factory';
import {
	ErrorMessage,
	SuccessMessage,
	WarningMessage,
} from '@/components/message-box';
import {reloadAppConfig} from '@/config/index';
import {formatConfigLintIssue, lintProviderConfig} from '@/config/lint';
import {loadAllProviderConfigs} from '@/config/mcp-config-loader';
import {saveTune, updateLastUsed} from '@/config/preferences';
import type {ActiveMode} from '@/hooks/useAppState';
import {getToolManager} from '@/message-handler';
import {getModelContextLimit, getSessionContextLimit} from '@/models/index';
import {generateKey} from '@/session/key-generator';
import type {AIProviderConfig, TuneConfig} from '@/types/config';
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
	setCurrentProviderConfig: (providerConfig: AIProviderConfig | null) => void;
	setMessages: (messages: Message[]) => void;
	messages: Message[];
	getMessageTokens: (message: Message) => number;
	setActiveMode: (mode: ActiveMode) => void;
	setIsSettingsMode: (mode: boolean) => void;
	addToChatQueue: (component: React.ReactNode) => void;
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
	setCurrentProviderConfig,
	setMessages,
	messages,
	getMessageTokens,
	setActiveMode,
	setIsSettingsMode,
	addToChatQueue,
	reinitializeMCPServers,
	setTune,
}: UseModeHandlersProps) {
	// Generic enter/exit helpers
	const enterMode = (mode: ActiveMode) => setActiveMode(mode);
	const exitMode = () => setActiveMode(null);

	// Switching models keeps the conversation (messages are model-agnostic and
	// the client is stateless). The one real risk is downsizing to a model whose
	// context window can't hold the existing history — surface that as a warning
	// so the user can /compact rather than silently overflowing the next request.
	const warnIfHistoryWontFit = async (
		model: string,
		providerConfig: AIProviderConfig | null,
	): Promise<void> => {
		if (messages.length === 0) return;
		try {
			const used = messages.reduce((sum, m) => sum + getMessageTokens(m), 0);
			const limit =
				getSessionContextLimit() ??
				(await getModelContextLimit(model, {
					providerConfig: providerConfig ?? undefined,
				}));
			if (limit && used > limit) {
				addToChatQueue(
					<WarningMessage
						key={generateKey('model-context-overflow')}
						message={`History (~${used.toLocaleString()} tokens) exceeds ${model}'s ~${limit.toLocaleString()} token window. Run /compact or /clear before continuing.`}
						hideBox={true}
					/>,
				);
			}
		} catch {
			// Best-effort: skip the warning if the model's limit can't be resolved.
		}
	};

	// Handle model selection. The model picker lists every model across every
	// provider, so a selection may also switch the active provider. Staying on
	// the same provider just swaps the model on the live client; crossing to a
	// different provider spins up a fresh client (and re-runs config lint).
	const handleModelSelect = async (
		selectedProvider: string,
		selectedModel: string,
	) => {
		const sameProvider = selectedProvider === currentProvider;

		if (sameProvider && selectedModel === currentModel) {
			exitMode();
			return true;
		}

		if (sameProvider) {
			if (client) {
				client.setModel(selectedModel);
				setCurrentModel(selectedModel);
				setCurrentProviderConfig(client.getProviderConfig());

				// Conversation is kept across model switches (see warnIfHistoryWontFit).

				// Update preferences
				updateLastUsed(currentProvider, selectedModel);

				addToChatQueue(
					<SuccessMessage
						key={generateKey('model-changed')}
						message={`Model changed to: ${selectedModel}.`}
						hideBox={true}
					/>,
				);

				await warnIfHistoryWontFit(selectedModel, client.getProviderConfig());
				exitMode();
				return true;
			}
			exitMode();
			return false;
		}

		// Different provider: create a new client targeting the chosen
		// provider and model.
		try {
			const {client: newClient, actualProvider} = await createLLMClient(
				selectedProvider,
				selectedModel,
			);

			if (actualProvider !== selectedProvider) {
				addToChatQueue(
					<ErrorMessage
						key={generateKey('provider-forced')}
						message={`${selectedProvider} is not available. Please ensure it's properly configured in agents.config.json.`}
						hideBox={true}
					/>,
				);
				return false;
			}

			setClient(newClient);
			setCurrentProvider(actualProvider);
			setCurrentProviderConfig(newClient.getProviderConfig());

			const newModel = newClient.getCurrentModel();
			setCurrentModel(newModel);

			// Conversation is kept across provider/model switches.

			updateLastUsed(actualProvider, newModel);

			addToChatQueue(
				<SuccessMessage
					key={generateKey('model-changed')}
					message={`Model changed to: ${newModel} (${actualProvider}).`}
					hideBox={true}
				/>,
			);

			await warnIfHistoryWontFit(newModel, newClient.getProviderConfig());

			// Re-run lint scoped to the newly active provider so any
			// misconfiguration becomes visible right when it would start
			// taking effect, rather than getting buried in startup output.
			const newProviderConfig = loadAllProviderConfigs().find(
				p => p.name === actualProvider,
			);
			if (newProviderConfig) {
				for (const issue of lintProviderConfig(newProviderConfig)) {
					addToChatQueue(
						<WarningMessage
							key={generateKey(`config-lint-${issue.provider}`)}
							message={formatConfigLintIssue(issue)}
							hideBox={true}
						/>,
					);
				}
			}
			return true;
		} catch (error) {
			addToChatQueue(
				<ErrorMessage
					key={generateKey('provider-error')}
					message={`Failed to switch to ${selectedProvider}: ${String(error)}`}
					hideBox={true}
				/>,
			);
			return false;
		} finally {
			exitMode();
		}
	};

	// Handle config wizard complete - reinitializes client and MCP servers
	const handleConfigWizardComplete = async (configPath?: string) => {
		exitMode();
		if (configPath) {
			addToChatQueue(
				<SuccessMessage
					key={generateKey('config-wizard-complete')}
					message={`Configuration saved to: ${configPath}.`}
					hideBox={true}
				/>,
			);

			reloadAppConfig();

			try {
				const {client: newClient, actualProvider} = await createLLMClient();
				setClient(newClient);
				setCurrentProvider(actualProvider);
				setCurrentProviderConfig(newClient.getProviderConfig());

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
								key={generateKey('mcp-reinit')}
								message="MCP servers reinitialized with new configuration."
								hideBox={true}
							/>,
						);
					} catch (mcpError) {
						addToChatQueue(
							<ErrorMessage
								key={generateKey('mcp-reinit-error')}
								message={`Failed to reinitialize MCP servers: ${String(mcpError)}`}
								hideBox={true}
							/>,
						);
					}
				}

				addToChatQueue(
					<SuccessMessage
						key={generateKey('config-init')}
						message={`Ready! Using provider: ${actualProvider}, model: ${newModel}`}
						hideBox={true}
					/>,
				);
			} catch (error) {
				addToChatQueue(
					<ErrorMessage
						key={generateKey('config-init-error')}
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
					key={generateKey('mcp-wizard-complete')}
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
							key={generateKey('mcp-reinit')}
							message="MCP servers reinitialized with new configuration."
							hideBox={true}
						/>,
					);
				} catch (mcpError) {
					addToChatQueue(
						<ErrorMessage
							key={generateKey('mcp-reinit-error')}
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
					key={generateKey('tune')}
					message={`Tune enabled (${parts.join(', ')}). Chat history cleared.`}
					hideBox={true}
				/>,
			);
		} else {
			addToChatQueue(
				<SuccessMessage
					key={generateKey('tune')}
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
		enterModelDatabaseMode: () => enterMode('modelDatabase'),
		enterConfigWizardMode: () => enterMode('configWizard'),
		enterMcpWizardMode: () => enterMode('mcpWizard'),
		enterExplorerMode: () => enterMode('explorer'),
		enterIdeSelectionMode: () => enterMode('ideSelection'),
		enterSettingsMode: () => setIsSettingsMode(true),
		// Cancel/complete handlers
		handleModelSelect,
		handleModelSelectionCancel: exitMode,
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
