import type {ToolManager} from '@/tools/tool-manager';
import type {CustomCommand} from '@/types/commands';
import type {CustomCommandLoader} from './loader';

/**
 * Integrates commands with auto-injection capabilities into the LLM system prompt.
 * Replaces the former SkillIntegration class.
 *
 * Commands that define `triggers` or `tags` in their frontmatter participate
 * in relevance scoring: the top matches are automatically appended to the
 * system prompt for each user request.
 */
export class CommandIntegration {
	private loader: CustomCommandLoader;
	private toolManager: ToolManager;

	constructor(loader: CustomCommandLoader, toolManager: ToolManager) {
		this.loader = loader;
		this.toolManager = toolManager;
	}

	/**
	 * Enhance the system prompt with relevant auto-injectable commands.
	 */
	enhanceSystemPrompt(basePrompt: string, request: string): string {
		const availableTools = this.toolManager.getToolNames();
		const relevant = this.loader.findRelevantCommands(request, availableTools);

		if (relevant.length === 0) {
			return basePrompt;
		}

		const commandPrompts: string[] = [];
		for (const command of relevant) {
			const block = this.formatCommandForPrompt(command);
			if (block) {
				commandPrompts.push(block);
			}
		}

		if (commandPrompts.length === 0) {
			return basePrompt;
		}

		const section = `

## Available Skills

You have access to the following Skills for this request:

${commandPrompts.join('\n\n')}

When a Skill is relevant, use its instructions. Tool restrictions listed in a Skill are enforced.`;

		return basePrompt + section;
	}

	/**
	 * Format a single command for inclusion in the system prompt.
	 */
	private formatCommandForPrompt(command: CustomCommand): string {
		const name = command.metadata.description ? command.name : command.fullName;
		let block = `### ${name}\n\n${command.content}`;

		if (command.metadata.examples?.length) {
			block += '\n\n**Examples:**\n';
			for (const ex of command.metadata.examples) {
				block += `- ${ex}\n`;
			}
		}

		if (command.loadedResources?.length) {
			block += '\n\n**Available Resources:**\n';
			for (const r of command.loadedResources) {
				const action = r.executable ? 'Execute' : 'Use';
				block += `- \`${r.name}\` (${r.type}): ${action} via skill resource\n`;
			}
		}

		return block;
	}
}
