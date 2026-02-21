import type {ToolManager} from '@/tools/tool-manager';
import type {Skill} from '@/types/skill';
import type {SkillManager} from './skill-manager';

const MAX_SKILLS_IN_CONTEXT = 3;

export class SkillIntegration {
	private skillManager: SkillManager;
	private toolManager: ToolManager;

	constructor(skillManager: SkillManager, toolManager: ToolManager) {
		this.skillManager = skillManager;
		this.toolManager = toolManager;
	}

	async enhanceSystemPrompt(
		basePrompt: string,
		request: string,
	): Promise<string> {
		const availableTools = this.toolManager.getToolNames();
		const relevantIds = await this.skillManager.findRelevantSkills(
			request,
			availableTools,
		);
		if (relevantIds.length === 0) {
			return basePrompt;
		}

		const topIds = relevantIds.slice(0, MAX_SKILLS_IN_CONTEXT);
		const skillPrompts: string[] = [];

		for (const skillId of topIds) {
			const skill = await this.skillManager.loadSkill(skillId);
			if (skill?.content) {
				skillPrompts.push(this.formatSkillForPrompt(skill));
			}
		}

		if (skillPrompts.length === 0) {
			return basePrompt;
		}

		const skillsSection = `

## Available Skills

You have access to the following Skills for this request:

${skillPrompts.join('\n\n')}

When a Skill is relevant, use its instructions. Tool restrictions listed in a Skill are enforced.`;

		return basePrompt + skillsSection;
	}

	private formatSkillForPrompt(skill: Skill): string {
		const content = skill.content;
		if (!content) return '';
		let block = `### ${skill.name}\n\n${content.instructions}`;

		if (content.examples?.length) {
			block += '\n\n**Examples:**\n';
			for (const ex of content.examples) {
				block += `- ${ex}\n`;
			}
		}

		if (skill.resources?.length) {
			block += '\n\n**Available Resources:**\n';
			for (const r of skill.resources) {
				const action = r.executable ? 'Execute' : 'Use';
				block += `- \`${r.name}\` (${r.type}): ${action} via skill resource\n`;
			}
		}

		return block;
	}

	validateSkillToolAccess(
		skillId: string,
		requestedTools: string[],
	): {allowed: string[]; blocked: string[]} {
		const skill = this.skillManager.getLoadedSkill(skillId);
		if (!skill?.allowedTools) {
			return {allowed: requestedTools, blocked: []};
		}

		const allowed: string[] = [];
		const blocked: string[] = [];

		for (const tool of requestedTools) {
			if (skill.allowedTools.includes(tool)) {
				allowed.push(tool);
			} else {
				blocked.push(tool);
			}
		}

		return {allowed, blocked};
	}
}
