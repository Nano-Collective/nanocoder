import {getAppConfig} from '@/config/index';
import {validateProjectConfigSecurity} from '@/config/validation';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {EventRouter} from '@/events/event-router';
import {bootSkillPipeline} from '@/skills/bootstrap';
import {getSubagentLoader} from '@/subagents/subagent-loader';
import {ToolManager} from '@/tools/tool-manager';
import {getLogger} from '@/utils/logging';

const logger = getLogger();

/**
 * The tools and slash commands of a project folder other than the one the
 * agent was started in: built-in tools, that folder's custom tools, commands
 * and skills, and the MCP servers of its `.mcp.json` (with your global ones).
 * The launch folder's are set up once at startup by `initializePlain`.
 */
export interface FolderTools {
	toolManager: ToolManager;
	customCommandLoader: CustomCommandLoader;
}

/**
 * Sets up a folder's tools the way `initializePlain` does for the launch
 * folder. Must run inside a session context for `root`, so the config it reads
 * (MCP servers, tune) is that folder's. Failures are logged and leave the
 * folder with what did load, as at startup.
 */
export async function loadFolderTools(root: string): Promise<FolderTools> {
	const toolManager = new ToolManager();
	const customCommandLoader = new CustomCommandLoader(root);

	try {
		const result = await bootSkillPipeline({
			projectRoot: root,
			toolManager,
			commandLoader: customCommandLoader,
			subagentLoader: getSubagentLoader(root),
			// Event sources are the daemon's; nothing is dispatched here.
			eventRouter: new EventRouter({dispatch: () => {}}),
		});
		for (const error of result.loadErrors) {
			logger.warn(
				`ACP folder ${root}: skill load error (${error.filePath ?? error.bundlePath}): ${error.message}`,
			);
		}
		for (const collision of result.registration.collisions) {
			logger.warn(
				`ACP folder ${root}: skill collision (${collision.skill} ${collision.kind}:${collision.name}): ${collision.message}`,
			);
		}
	} catch (error) {
		logger.warn(`ACP folder ${root}: skill pipeline failed: ${String(error)}`);
	}

	const config = getAppConfig();
	if (config.mcpServers && config.mcpServers.length > 0) {
		try {
			validateProjectConfigSecurity(config.mcpServers);
			await toolManager.initializeMCP(
				config.mcpServers,
				result => {
					if (result.success) {
						logger.info(
							`ACP folder ${root}: MCP server connected: ${result.serverName}`,
						);
					} else {
						logger.warn(
							`ACP folder ${root}: MCP server failed: ${result.serverName} (${result.error})`,
						);
					}
				},
				undefined,
				config.tune,
			);
		} catch (error) {
			logger.warn(
				`ACP folder ${root}: MCP initialization failed: ${String(error)}`,
			);
		}
	}

	return {toolManager, customCommandLoader};
}
