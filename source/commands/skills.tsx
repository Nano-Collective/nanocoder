/**
 * /skills command
 * List, show, and refresh Skills (modular capabilities)
 */

import React from 'react';
import {InfoMessage} from '@/components/message-box';
import {getToolManager} from '@/message-handler';
import type {SkillManager} from '@/skills';
import type {Command} from '@/types/commands';
import type {Message} from '@/types/core';
import type {SkillMetadata} from '@/types/skill';

function getSkillManager(): SkillManager | null {
	const tm = getToolManager();
	return tm?.getSkillManager() ?? null;
}

async function listAvailableSkills(
	skillManager: SkillManager,
): Promise<React.ReactElement> {
	const skills = skillManager.getAvailableSkills();
	if (skills.length === 0) {
		return React.createElement(InfoMessage, {
			key: `skills-${Date.now()}`,
			message:
				'No Skills available. Add skills in your config directory under skills/ (e.g. ~/.config/nanocoder/skills) or .nanocoder/skills in your project.',
			hideBox: true,
		});
	}

	const byCategory = skills.reduce(
		(acc, skill) => {
			const cat = skill.category || 'general';
			if (!acc[cat]) acc[cat] = [];
			acc[cat].push(skill);
			return acc;
		},
		{} as Record<string, SkillMetadata[]>,
	);

	let output = `Available Skills (${skills.length})\n\n`;
	for (const [category, categorySkills] of Object.entries(byCategory)) {
		output += `${category}\n`;
		for (const skill of categorySkills) {
			const tokenEst = skill.estimatedTokens
				? ` (~${skill.estimatedTokens} tokens)`
				: '';
			output += `  • ${skill.name}${tokenEst}\n`;
			output += `    id: ${skill.id ?? '?'}\n`;
			output += `    ${skill.description}\n`;
			if (skill.tags?.length) {
				output += `    Tags: ${skill.tags.map(t => `\`${t}\``).join(', ')}\n`;
			}
		}
		output += '\n';
	}
	output +=
		'Use /skills show <id> for details. Id is e.g. project:my-skill or personal:my-skill.';

	return React.createElement(InfoMessage, {
		key: `skills-${Date.now()}`,
		message: output,
		hideBox: true,
	});
}

async function showSkillDetails(
	skillManager: SkillManager,
	skillId: string,
): Promise<React.ReactElement> {
	if (!skillId) {
		return React.createElement(InfoMessage, {
			key: `skills-${Date.now()}`,
			message: 'Usage: /skills show <skill-id> (e.g. project:api-docs)',
			hideBox: true,
		});
	}

	const skill = await skillManager.loadSkill(skillId);
	if (!skill) {
		return React.createElement(InfoMessage, {
			key: `skills-${Date.now()}`,
			message: `Skill "${skillId}" not found. Use /skills to list available Skills.`,
			hideBox: true,
		});
	}

	let output = `${skill.name}\n`;
	output += `Category: ${skill.category}  Version: ${skill.version}\n`;
	if (skill.author) output += `Author: ${skill.author}\n`;
	output += `Source: ${skill.source.type} (${skill.location})\n\n`;
	output += `${skill.description}\n\n`;
	if (skill.allowedTools?.length) {
		output += `Allowed tools: ${skill.allowedTools.map(t => `\`${t}\``).join(', ')}\n\n`;
	}
	if (skill.content?.examples?.length) {
		output += 'Examples:\n';
		for (const ex of skill.content.examples) {
			output += `  - ${ex}\n`;
		}
		output += '\n';
	}
	if (skill.resources?.length) {
		output += 'Resources:\n';
		for (const r of skill.resources) {
			output += `  • ${r.name} (${r.type})${r.executable ? ' [executable]' : ''}\n`;
		}
		output += '\n';
	}
	if (skill.content?.references?.length) {
		output += `References: ${skill.content.references.join(', ')}\n\n`;
	}
	output += `Last modified: ${skill.lastModified.toLocaleDateString()}`;

	return React.createElement(InfoMessage, {
		key: `skills-show-${Date.now()}`,
		message: output,
		hideBox: true,
	});
}

export const skillsCommand: Command = {
	name: 'skills',
	description: 'List and show Skills (modular capabilities)',
	handler: async (
		args: string[],
		_messages: Message[],
		_metadata: {
			provider: string;
			model: string;
			tokens: number;
			getMessageTokens: (message: Message) => number;
		},
	) => {
		const skillManager = getSkillManager();
		if (!skillManager) {
			return React.createElement(InfoMessage, {
				key: `skills-${Date.now()}`,
				message: 'Skills not available (tool manager not ready).',
				hideBox: true,
			});
		}

		const sub = args[0];
		if (!sub || sub === 'list') {
			return listAvailableSkills(skillManager);
		}
		if (sub === 'show') {
			return showSkillDetails(skillManager, args[1] ?? '');
		}
		if (sub === 'refresh') {
			await skillManager.initialize();
			return React.createElement(InfoMessage, {
				key: `skills-${Date.now()}`,
				message: 'Skills cache refreshed.',
				hideBox: true,
			});
		}

		return React.createElement(InfoMessage, {
			key: `skills-${Date.now()}`,
			message: 'Usage: /skills [list | show <id> | refresh]',
			hideBox: true,
		});
	},
};
