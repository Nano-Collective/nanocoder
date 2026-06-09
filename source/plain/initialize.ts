import {ConfigurationError, createLLMClient} from '@/client-factory';
import {commandRegistry} from '@/commands';
import {lazyCommands} from '@/commands/lazy-registry';
import {getAppConfig} from '@/config/index';
import {
	getLastUsedModel,
	loadPreferences,
	updateLastUsed,
} from '@/config/preferences';
import {validateProjectConfigSecurity} from '@/config/validation';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {
	setCommandLoaderGetter,
	setToolManagerGetter,
	setToolRegistryGetter,
} from '@/message-handler';
import {writeStatus} from '@/plain/writer';
import {SubagentExecutor} from '@/subagents/subagent-executor';
import {getSubagentLoader} from '@/subagents/subagent-loader';
import {setAgentToolExecutor, setAvailableAgentNames} from '@/tools/agent-tool';
import {clearAllTasks} from '@/tools/tasks';
import {ToolManager} from '@/tools/tool-manager';
import type {LLMClient, MCPInitResult} from '@/types/index';
import {setAvailableSubagents} from '@/utils/prompt-processor';

export interface PlainInitResult {
	client: LLMClient;
	toolManager: ToolManager;
	customCommandLoader: CustomCommandLoader;
	provider: string;
	model: string;
}

export interface PlainInitOptions {
	cliProvider?: string;
	cliModel?: string;
}

/**
 * Framework-agnostic equivalent of useAppInitialization for the plain
 * non-interactive runtime. Replaces React state setters with stderr status
 * lines and throws on configuration failures (no interactive recovery
 * surface in plain mode).
 */
export async function initializePlain(
	options: PlainInitOptions = {},
): Promise<PlainInitResult> {
	void clearAllTasks();

	const toolManager = new ToolManager();
	const customCommandLoader = new CustomCommandLoader();
	const preferences = loadPreferences();

	setToolRegistryGetter(() => toolManager.getToolRegistry());
	setToolManagerGetter(() => toolManager);
	setCommandLoaderGetter(() => customCommandLoader);
	commandRegistry.registerLazy(lazyCommands);

	const preferredProvider = options.cliProvider || preferences.lastProvider;
	const preferredModel = options.cliModel;

	let client: LLMClient;
	let actualProvider: string;
	try {
		const result = await createLLMClient(preferredProvider, preferredModel);
		client = result.client;
		actualProvider = result.actualProvider;
	} catch (error) {
		if (error instanceof ConfigurationError) {
			throw new Error(
				error.isEmptyConfig || error.message.includes('No providers configured')
					? 'No providers configured. Run nanocoder interactively to set them up.'
					: error.message,
			);
		}
		throw new Error(`Failed to initialize provider: ${String(error)}`);
	}

	let finalModel: string;
	if (preferredModel) {
		finalModel = client.getCurrentModel();
	} else {
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

	updateLastUsed(actualProvider, finalModel);

	const subagentExecutor = new SubagentExecutor(toolManager, client);
	setAgentToolExecutor(subagentExecutor);

	const subagentLoader = getSubagentLoader();

	// Unified skill boot: drives the legacy loaders (commands / subagents /
	// custom tools) and the bundle loader through a single pipeline. Event
	// sources are not started in plain mode (the daemon owns those).
	try {
		const {EventRouter} = await import('@/events/event-router');
		const {bootSkillPipeline} = await import('@/skills/bootstrap');
		const router = new EventRouter({dispatch: () => {}});
		const result = await bootSkillPipeline({
			projectRoot: process.cwd(),
			toolManager,
			commandLoader: customCommandLoader,
			subagentLoader,
			eventRouter: router,
		});
		for (const err of result.loadErrors) {
			const where = err.filePath ?? err.bundlePath;
			writeStatus(`Skill load error (${where}): ${err.message}`);
		}
		for (const c of result.registration.collisions) {
			writeStatus(
				`Skill collision (${c.skill} ${c.kind}:${c.name}): ${c.message}`,
			);
		}
		for (const warning of result.deprecations) {
			writeStatus(warning);
		}
	} catch (error) {
		writeStatus(`Failed to boot skill pipeline: ${String(error)}`);
	}

	const availableAgents = await subagentLoader.listSubagents();
	const agentSummaries = availableAgents.map(a => ({
		name: a.name,
		description: a.description,
	}));
	setAvailableSubagents(agentSummaries);
	setAvailableAgentNames(agentSummaries);

	await initializeMCP(toolManager);

	return {
		client,
		toolManager,
		customCommandLoader,
		provider: actualProvider,
		model: finalModel,
	};
}

async function initializeMCP(toolManager: ToolManager): Promise<void> {
	const config = getAppConfig();
	if (!config.mcpServers || config.mcpServers.length === 0) return;

	validateProjectConfigSecurity(config.mcpServers);

	const onProgress = (result: MCPInitResult) => {
		if (result.success) {
			writeStatus(`MCP server connected: ${result.serverName}`);
		} else {
			writeStatus(`MCP server failed: ${result.serverName} (${result.error})`);
		}
	};

	try {
		await toolManager.initializeMCP(config.mcpServers, onProgress);
	} catch (error) {
		writeStatus(`MCP initialization error: ${String(error)}`);
	}
}
