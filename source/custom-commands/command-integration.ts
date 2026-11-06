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
	 * Build the `## Available Skills` section for a request, or `''` when no
	 * skill is relevant to it.
	 *
	 * The caller carries this in the turn's user message rather than the system
	 * prompt: the skills are matched against *this* request, so appending them
	 * to the system prompt changed the system block on every turn and cost
	 * local backends a full prefill (#1574). See `@/utils/turn-context`.
	 */
	buildSkillsSection(request: string): string {
		const availableTools = this.toolManager.getToolNames();
		const relevant = this.loader.findRelevantCommands(request, availableTools);

		if (relevant.length === 0) {
			return '';
		}

		const commandPrompts: string[] = [];
		for (const command of relevant) {
			const block = this.formatCommandForPrompt(command);
			if (block) {
				commandPrompts.push(block);
			}
		}

		if (commandPrompts.length === 0) {
			return '';
		}

		return `## Available Skills

You have access to the following Skills for this request:

${commandPrompts.join('\n\n')}

When a Skill is relevant, use its instructions.`;
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
