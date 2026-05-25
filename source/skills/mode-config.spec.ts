import test from 'ava';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {EventRouter} from '@/events/event-router';
import {SubagentLoader} from '@/subagents/subagent-loader';
import {ToolManager} from '@/tools/tool-manager';
import {jsonSchema, tool, type ToolEntry} from '@/types/core';
import type {Skill} from '@/types/skills';
import {registerSkills} from './registrar';

console.log(`\nmode-config.spec.ts`);

function makeToolEntry(name: string): ToolEntry {
	return {
		name,
		tool: tool({
			description: `${name} tool`,
			inputSchema: jsonSchema({type: 'object', properties: {}}),
			execute: async () => 'ok',
		}),
		handler: async () => 'ok',
	};
}

function setup(): {
	toolManager: ToolManager;
	commandLoader: CustomCommandLoader;
	subagentLoader: SubagentLoader;
	eventRouter: EventRouter;
} {
	return {
		toolManager: new ToolManager(),
		commandLoader: new CustomCommandLoader('/tmp/mode-config-spec'),
		subagentLoader: new SubagentLoader('/tmp/mode-config-spec'),
		eventRouter: new EventRouter({dispatch: () => {}}),
	};
}

test('skill tools appear in toolManager.getToolNames after registration', t => {
	const deps = setup();
	const skill: Skill = {
		name: 'gh',
		description: 'github helper',
		toolsVisibility: 'global',
		source: {
			priority: 'project',
			shape: 'single-file',
			rootPath: '/p/.nanocoder/tools/gh_pr_diff.md',
		},
		tools: [
			{
				tool: makeToolEntry('gh_pr_diff'),
				filePath: '/p/.nanocoder/tools/gh_pr_diff.md',
			},
		],
	};
	registerSkills([skill], deps);
	t.true(deps.toolManager.hasTool('gh_pr_diff'));
});

test('disabledTools filters skill tools by name', t => {
	const deps = setup();
	const skill: Skill = {
		name: 'gh',
		description: 'github helper',
		toolsVisibility: 'global',
		source: {
			priority: 'project',
			shape: 'single-file',
			rootPath: '/p/.nanocoder/tools/gh_pr_diff.md',
		},
		tools: [
			{
				tool: makeToolEntry('gh_pr_diff'),
				filePath: '/p/.nanocoder/tools/gh_pr_diff.md',
			},
		],
	};
	registerSkills([skill], deps);

	// Pre-filter: skill tool present
	const beforeFilter = deps.toolManager.getAvailableToolNames(undefined, 'normal');
	t.true(beforeFilter.includes('gh_pr_diff'));

	// After explicit disable: skill tool gone
	const afterFilter = deps.toolManager.getAvailableToolNames(undefined, 'normal', [
		'gh_pr_diff',
	]);
	t.false(afterFilter.includes('gh_pr_diff'));
});

test('plan mode still excludes ask_user / agent from skill-aware view', t => {
	const deps = setup();
	const skill: Skill = {
		name: 'gh',
		description: 'github helper',
		toolsVisibility: 'global',
		source: {
			priority: 'project',
			shape: 'single-file',
			rootPath: '/p/.nanocoder/tools/gh_pr_diff.md',
		},
		tools: [
			{
				tool: makeToolEntry('gh_pr_diff'),
				filePath: '/p/.nanocoder/tools/gh_pr_diff.md',
			},
		],
	};
	registerSkills([skill], deps);

	// plan-mode excludes write tools but not read-only globals
	const planNames = deps.toolManager.getAvailableToolNames(undefined, 'plan');
	t.false(planNames.includes('write_file'));

	// headless excludes ask_user / agent
	const headless = deps.toolManager.getAvailableToolNames(
		undefined,
		'headless',
	);
	t.false(headless.includes('ask_user'));
	t.false(headless.includes('agent'));
});

test('scoped skill tools are hidden from getAllTools by default', t => {
	const deps = setup();
	const skill: Skill = {
		name: 'k8s',
		description: 'k8s helper',
		toolsVisibility: 'scoped',
		source: {priority: 'project', shape: 'bundle', rootPath: '/skills/k8s'},
		tools: [
			{
				tool: makeToolEntry('k8s_pods'),
				filePath: '/skills/k8s/tools/k8s_pods.md',
			},
		],
	};
	registerSkills([skill], deps);
	t.false('k8s_pods' in deps.toolManager.getAllTools());
	t.true('k8s_pods' in deps.toolManager.getAllTools({forSkill: 'k8s'}));
});
