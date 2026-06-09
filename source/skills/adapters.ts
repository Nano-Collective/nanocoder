/**
 * Wrap a single parsed command / subagent / tool into a one-member `Skill`.
 *
 * The flat-dir loader (step 7) runs the existing per-kind parsers and then
 * funnels each parsed config through one of these adapters. Downstream
 * registration sees a `Skill`, regardless of whether the source was a flat
 * `.md` or a bundle subdirectory file.
 *
 * Defaults:
 *   - `source.shape = 'single-file'`
 *   - `source.rootPath = filePath`
 *   - `toolsVisibility = 'global'` (preserves today's behaviour for
 *     `.nanocoder/tools/*.md`; bundles opt back via manifest)
 *   - subscriptions inherit the member as their implicit target
 */

import {basename} from 'node:path';
import type {SubagentConfig} from '@/subagents/types';
import type {CustomCommand} from '@/types/commands';
import type {ToolEntry} from '@/types/core';
import type {Skill, SkillPriority, SkillTrigger} from '@/types/skills';

export interface SingleFileSkillOptions {
	filePath: string;
	priority: SkillPriority;
	subscribe?: SkillTrigger[];
}

export function commandToSkill(
	command: CustomCommand,
	opts: SingleFileSkillOptions,
): Skill {
	const name = baseName(opts.filePath);
	return {
		name,
		description: command.metadata.description ?? name,
		commands: [{command, filePath: opts.filePath}],
		subscribe: opts.subscribe,
		toolsVisibility: 'global',
		source: {
			priority: opts.priority,
			shape: 'single-file',
			rootPath: opts.filePath,
		},
	};
}

export function subagentToSkill(
	subagent: SubagentConfig,
	opts: SingleFileSkillOptions,
): Skill {
	return {
		name: baseName(opts.filePath),
		description: subagent.description,
		subagent: {subagent, filePath: opts.filePath},
		subscribe: opts.subscribe,
		toolsVisibility: 'global',
		source: {
			priority: opts.priority,
			shape: 'single-file',
			rootPath: opts.filePath,
		},
	};
}

export function toolToSkill(
	tool: ToolEntry,
	opts: SingleFileSkillOptions,
): Skill {
	const name = baseName(opts.filePath);
	const description =
		typeof tool.tool.description === 'string' && tool.tool.description.trim()
			? tool.tool.description
			: name;
	return {
		name,
		description,
		tools: [{tool, filePath: opts.filePath}],
		subscribe: opts.subscribe,
		toolsVisibility: 'global',
		source: {
			priority: opts.priority,
			shape: 'single-file',
			rootPath: opts.filePath,
		},
	};
}

function baseName(filePath: string): string {
	return basename(filePath, '.md');
}
