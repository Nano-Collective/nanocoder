import React, {useEffect} from 'react';
import {ConfigurationError, createLLMClient} from '@/client-factory';
import {commandRegistry} from '@/commands';
// Built-in commands are registered via a lazy registry so their modules
// aren't loaded at startup — each command's handler is imported on first
// invocation. See `source/commands/lazy-registry.ts`.
import {lazyCommands} from '@/commands/lazy-registry';
import {
	ErrorMessage,
	InfoMessage,
	WarningMessage,
} from '@/components/message-box';
import {getAppConfig, reloadAppConfig} from '@/config/index';
import {formatConfigLintIssue, lintProviderConfigs} from '@/config/lint';
import {loadAllProviderConfigs} from '@/config/mcp-config-loader';
import {
	getLastUsedModel,
	loadPreferences,
	updateLastUsed,
} from '@/config/preferences';
import {validateProjectConfigSecurity} from '@/config/validation';
import {TIMEOUT_OUTPUT_FLUSH_MS} from '@/constants';
import {CustomCommandExecutor} from '@/custom-commands/executor';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {getLSPManager, type LSPInitResult} from '@/lsp/index';
import {
	setCommandLoaderGetter,
	setToolManagerGetter,
	setToolRegistryGetter,
} from '@/message-handler';
import {generateKey} from '@/session/key-generator';
import {SubagentExecutor} from '@/subagents/subagent-executor';
import {getSubagentLoader} from '@/subagents/subagent-loader';
import {setAgentToolExecutor, setAvailableAgentNames} from '@/tools/agent-tool';
import {clearAllTasks} from '@/tools/tasks';
import {ToolManager} from '@/tools/tool-manager';
import type {CustomCommand} from '@/types/commands';
import {
	LLMClient,
	LSPConnectionStatus,
	MCPConnectionStatus,
} from '@/types/core';
import type {MCPInitResult, UpdateInfo, UserPreferences} from '@/types/index';
import {setAvailableSubagents} from '@/utils/prompt-processor';
import {getShutdownManager} from '@/utils/shutdown';
import {checkForUpdates} from '@/utils/update-checker';

interface UseAppInitializationProps {
	setClient: (client: LLMClient | null) => void;
	setCurrentModel: (model: string) => void;
	setCurrentProvider: (provider: string) => void;
	setCurrentProviderConfig: (
		providerConfig: import('@/types/config').AIProviderConfig | null,
	) => void;
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
	setSubagentsReady: (ready: boolean) => void;
	addToChatQueue: (component: React.ReactNode) => void;
	customCommandCache: Map<string, CustomCommand>;
	setActiveMode: (mode: import('@/hooks/useAppState').ActiveMode) => void;
	cliProvider?: string;
	cliModel?: string;
	/**
	 * Live development-mode ref (same one the main loop reads). Wired into the
	 * SubagentExecutor so subagent tool approvals honor the current mode,
	 * including a switch made while a subagent is running.
	 */
	developmentModeRef?: React.RefObject<import('@/types/index').DevelopmentMode>;
	/**
	 * When true, init failures (no client) shut down the process with code 1
	 * instead of leaving the run stuck in "Waiting for MCP servers..." — the
	 * config wizard and chat queue are interactive-only surfaces that can't
	 * resolve under `nanocoder run`.
	 */
	nonInteractiveMode?: boolean;
}

export function useAppInitialization({
	setClient,
	setCurrentModel,
	setCurrentProvider,
	setCurrentProviderConfig,
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
	setSubagentsReady,
	addToChatQueue,
	customCommandCache,
	setActiveMode,
	cliProvider,
	cliModel,
	nonInteractiveMode = false,
	developmentModeRef,
}: UseAppInitializationProps) {
	// Initialize LLM client and model
	const initializeClient = async (
		preferredProvider?: string,
		preferredModel?: string,
		isProgrammatic: boolean = false,
	): Promise<LLMClient | null> => {
		// Lint provider configs before instantiation so typos and misplaced
		// blocks surface as warnings in the chat queue, without a box —
		// matches the existing "no box" convention for inline diagnostics.
		const lintIssues = lintProviderConfigs(loadAllProviderConfigs());
		for (const issue of lintIssues) {
			addToChatQueue(
				<WarningMessage
					key={generateKey(`config-lint-${issue.provider}`)}
					message={formatConfigLintIssue(issue)}
					hideBox={true}
				/>,
			);
		}

		const {client, actualProvider} = await createLLMClient(
			preferredProvider,
			preferredModel,
		);
		setClient(client);
		setCurrentProvider(actualProvider);
		setCurrentProviderConfig(client.getProviderConfig());

		// Use CLI model if provided (already set by createLLMClient), otherwise try last used model
		let finalModel: string;
		if (preferredModel) {
			finalModel = client.getCurrentModel();
		} else {
			// Try to use the last used model for this provider
			const lastUsedModel = getLastUsedModel(actualProvider);

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
		}

		setCurrentModel(finalModel);
		setCurrentProviderConfig(client.getProviderConfig());

		if (!isProgrammatic) {
			// Save the preference - use actualProvider and the model that was actually set
			updateLastUsed(actualProvider, finalModel);
		}

		return client;
	};

	// Seed the autocomplete cache from a populated CustomCommandLoader. The
	// unified bootstrap is responsible for calling loader.loadCommands(); this
	// helper just reads the result back out for the picker UI.
	const refreshCustomCommandCache = (loader: CustomCommandLoader) => {
		const customCommands = loader.getAllCommands() || [];
		customCommandCache.clear();
		for (const command of customCommands) {
			customCommandCache.set(command.name, command);
			if (command.metadata?.aliases) {
				for (const alias of command.metadata.aliases) {
					customCommandCache.set(alias, command);
				}
			}
		}
		setCustomCommandsCount(customCommands.length);
	};

	// Back-compat shim: callers that want to force a reload of the on-disk
	// command files (e.g. /commands refresh).
	const loadCustomCommands = (loader: CustomCommandLoader) => {
		loader.loadCommands();
		refreshCustomCommandCache(loader);
	};

	// Initialize MCP servers if configured
	const initializeMCPServers = async (toolManager: ToolManager) => {
		const config = getAppConfig();
		if (config.mcpServers && config.mcpServers.length > 0) {
			// Validate security for project-level configurations
			validateProjectConfigSecurity(config.mcpServers);

			// Initialize status array
			const mcpStatus: MCPConnectionStatus[] = config.mcpServers.map(
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
				await toolManager.initializeMCP(config.mcpServers, onProgress);
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
		const lspConfig = getAppConfig();
		const lspManager = await getLSPManager({
			rootUri: `file://${process.cwd()}`,
			autoDiscover: true,
			// Use custom servers from config if provided
			servers: lspConfig.lspServers?.map(server => ({
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
		if (lspConfig.lspServers) {
			for (const server of lspConfig.lspServers) {
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
				servers: lspConfig.lspServers?.map(server => ({
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
		toolManager: ToolManager,
		newCustomCommandLoader: CustomCommandLoader,
		preferences: UserPreferences,
	): Promise<void> => {
		try {
			const config = getAppConfig();
			const currentMode = developmentModeRef?.current || 'normal';
			const modeConfig = config.modeProviders?.[currentMode];

			// Use CLI provider/model if provided, otherwise mode-specific, otherwise preferences
			const isProgrammatic = !(cliProvider || cliModel) && !!modeConfig;
			let provider =
				cliProvider || modeConfig?.provider || preferences.lastProvider;
			// A saved/mode provider can go stale (renamed or removed from
			// agents.config.json). Passing it through would make createLLMClient
			// throw and strand the app on an error screen with no client. Fall
			// back to the default-provider path with a warning instead. An
			// explicit --provider CLI arg stays strict: the user asked for that
			// provider by name, so a hard error is the honest response.
			if (!cliProvider && provider) {
				const staleName = provider;
				const known = loadAllProviderConfigs().some(
					p => p.name.toLowerCase() === staleName.toLowerCase(),
				);
				if (!known) {
					addToChatQueue(
						<WarningMessage
							key={generateKey('stale-provider')}
							message={`Saved provider '${staleName}' is not in agents.config.json — falling back to the first configured provider.`}
							hideBox={true}
						/>,
					);
					provider = undefined;
				}
			}
			const model = cliModel || modeConfig?.model || undefined;
			const client = await initializeClient(provider, model, isProgrammatic);

			// Create and initialize the SubagentExecutor if client was successfully created
			if (client) {
				const executor = new SubagentExecutor(toolManager, client);
				// Read the live development mode per tool call so subagents honor
				// the current mode (and mid-run switches), matching the main loop.
				if (developmentModeRef) {
					executor.setModeResolver(
						() => developmentModeRef.current ?? 'normal',
					);
				}
				setAgentToolExecutor(executor);
			}
		} catch (error) {
			// Check if it's a ConfigurationError
			if (error instanceof ConfigurationError) {
				// Only trigger wizard if config is empty/missing, not for invalid CLI args
				if (
					error.isEmptyConfig ||
					error.message.includes('No providers configured')
				) {
					if (nonInteractiveMode) {
						// Wizard is interactive-only — exit cleanly under `run`.
						addToChatQueue(
							<ErrorMessage
								key={generateKey('config-error')}
								message="No providers configured. Run nanocoder interactively to set them up."
								hideBox={true}
							/>,
						);
					} else {
						addToChatQueue(
							<InfoMessage
								key={generateKey('config-error')}
								message="Configuration needed. Let's set up your providers..."
								hideBox={true}
							/>,
						);
						// Trigger wizard mode after showing UI
						setTimeout(() => {
							setActiveMode('configWizard');
						}, 100);
					}
				} else {
					// Invalid CLI provider/model - show error and don't trigger wizard
					addToChatQueue(
						<ErrorMessage
							key={generateKey('config-error')}
							message={error.message}
							hideBox={true}
						/>,
					);
				}
			} else if (
				error instanceof Error &&
				error.message.includes('All configured providers failed')
			) {
				// Every configured provider failed to initialize. Without a
				// client the app is unusable, so surface the per-provider
				// errors and open the provider wizard — the user has to fix
				// or re-enter a provider either way.
				addToChatQueue(
					<ErrorMessage
						key={generateKey('init-error')}
						message={error.message}
						hideBox={true}
					/>,
				);
				if (!nonInteractiveMode) {
					setTimeout(() => {
						setActiveMode('configWizard');
					}, 100);
				}
			} else {
				// Regular error - show simple error message
				addToChatQueue(
					<ErrorMessage
						key={generateKey('init-error')}
						message={`No providers available: ${String(error)}`}
						hideBox={true}
					/>,
				);
			}
			// In non-interactive mode there's no human to recover via /model —
			// keep init from blocking on a null client by exiting once the
			// error has had a chance to flush to stdout.
			if (nonInteractiveMode) {
				setTimeout(() => {
					void getShutdownManager().gracefulShutdown(1);
				}, TIMEOUT_OUTPUT_FLUSH_MS);
			}
			// Leave client as null - the UI will handle this gracefully
		}

		// Unified skill boot: runs the legacy loaders (CustomCommandLoader,
		// SubagentLoader, ToolManager.initializeCustomTools), then layers
		// bundle-form skills on top via the registrar. /skills sees both
		// forms; the TUI itself does not host event sources (the daemon does)
		// so subscriptions register but do not fire here.
		try {
			const {EventRouter} = await import('@/events/event-router');
			const {bootSkillPipeline} = await import('@/skills/bootstrap');
			const {getSubagentLoader} = await import('@/subagents/subagent-loader');
			const router = new EventRouter({dispatch: () => {}});
			const subagentLoader = getSubagentLoader();
			const result = await bootSkillPipeline({
				projectRoot: process.cwd(),
				toolManager,
				commandLoader: newCustomCommandLoader,
				subagentLoader,
				eventRouter: router,
			});
			refreshCustomCommandCache(newCustomCommandLoader);

			// The critical-path branch above publishes the agent list *before*
			// bundle skills register their subagents. Re-publish now so the
			// `agent` tool's parameter description and the system prompt's
			// subagent block include bundle agents (e.g. k8s_agent).
			const refreshedAgents = await subagentLoader.listSubagents();
			const refreshedSummaries = refreshedAgents.map(a => ({
				name: a.name,
				description: a.description,
			}));
			setAvailableSubagents(refreshedSummaries);
			setAvailableAgentNames(refreshedSummaries);
			for (const err of result.loadErrors) {
				const where = err.filePath ?? err.bundlePath;
				addToChatQueue(
					<ErrorMessage
						key={generateKey('skill-load-error')}
						message={`Skill load error (${where}): ${err.message}`}
						hideBox={true}
					/>,
				);
			}
			for (const c of result.registration.collisions) {
				addToChatQueue(
					<ErrorMessage
						key={generateKey('skill-collision')}
						message={`Skill collision (${c.skill} ${c.kind}:${c.name}): ${c.message}`}
						hideBox={true}
					/>,
				);
			}
			for (const warning of result.deprecations) {
				addToChatQueue(
					<ErrorMessage
						key={generateKey('skill-deprecation')}
						message={warning}
						hideBox={true}
					/>,
				);
			}
		} catch (error) {
			addToChatQueue(
				<ErrorMessage
					key={generateKey('skill-init-error')}
					message={`Failed to load skill bundles: ${String(error)}`}
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
			setCurrentProviderConfig(null);

			// Clear task list — fire-and-forget, just deletes a JSON file
			void clearAllTasks();

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

			// Set up the command loader getter so /commands and friends
			// read from the same instance the bootstrap populates.
			setCommandLoaderGetter(() => newCustomCommandLoader);

			commandRegistry.registerLazy(lazyCommands);

			// === CRITICAL PATH ===
			// LLM client + subagents are independent — run in parallel.
			// Everything else (update check, MCP, LSP) runs in the background.
			const subagentLoader = getSubagentLoader();
			await Promise.all([
				start(newToolManager, newCustomCommandLoader, preferences),
				subagentLoader.initialize().then(async () => {
					const availableAgents = await subagentLoader.listSubagents();
					const agentSummaries = availableAgents.map(a => ({
						name: a.name,
						description: a.description,
					}));
					setAvailableSubagents(agentSummaries);
					setAvailableAgentNames(agentSummaries);
					setSubagentsReady(true);
				}),
			]);

			// === SHOW CHAT UI ===
			// The Status box was removed from startup (it's now /status),
			// so nothing gates on MCP/LSP/update-check completing. Show
			// the prompt immediately after the LLM client + subagents are
			// ready. Everything else connects in the background.
			setMcpInitialized(true);
			setStartChat(true);

			// === BACKGROUND WORK ===
			// All three run concurrently after the chat is interactive.
			// MCP tools register dynamically as servers connect; LSP
			// diagnostics appear when ready; update banner shows when the
			// npm check resolves.
			void checkForUpdates()
				.then(info => setUpdateInfo(info))
				.catch(() => setUpdateInfo(null));

			void initializeMCPServers(newToolManager);

			void initializeLSPServers();
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
