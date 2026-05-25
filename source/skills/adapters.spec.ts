import test from 'ava';
import type {SubagentConfig} from '@/subagents/types';
import type {CustomCommand} from '@/types/commands';
import {jsonSchema, tool, type ToolEntry} from '@/types/core';
import {commandToSkill, subagentToSkill, toolToSkill} from './adapters';

console.log(`\nadapters.spec.ts`);

const FILE_PATH = '/tmp/skills-test/.nanocoder/commands/weekly-report.md';

function makeCommand(overrides: Partial<CustomCommand> = {}): CustomCommand {
	return {
		name: 'weekly-report',
		path: FILE_PATH,
		fullName: 'weekly-report',
		metadata: {description: 'Monday summary.'},
		content: 'Summarize last week...',
		...overrides,
	};
}

function makeSubagent(overrides: Partial<SubagentConfig> = {}): SubagentConfig {
	return {
		name: 'docs-agent',
		description: 'Watch docs and refresh outputs.',
		systemPrompt: 'You watch docs.',
		...overrides,
	};
}

function makeTool(description = 'Open a PR diff.'): ToolEntry {
	return {
		name: 'gh_pr_diff',
		tool: tool({
			description,
			inputSchema: jsonSchema({
				type: 'object',
				properties: {pr: {type: 'string'}},
				required: ['pr'],
			}),
			execute: async () => 'ok',
		}),
		handler: async () => 'ok',
	};
}

test('commandToSkill: name from filename, description from metadata', t => {
	const skill = commandToSkill(makeCommand(), {
		filePath: FILE_PATH,
		priority: 'project',
	});
	t.is(skill.name, 'weekly-report');
	t.is(skill.description, 'Monday summary.');
	t.is(skill.commands?.length, 1);
	t.is(skill.commands?.[0]?.filePath, FILE_PATH);
	t.truthy(skill.commands?.[0]?.command);
	t.is(skill.subagent, undefined);
	t.is(skill.tools, undefined);
});

test('commandToSkill: falls back to filename when no description', t => {
	const skill = commandToSkill(makeCommand({metadata: {}}), {
		filePath: FILE_PATH,
		priority: 'personal',
	});
	t.is(skill.description, 'weekly-report');
});

test('commandToSkill: propagates subscribe', t => {
	const skill = commandToSkill(makeCommand(), {
		filePath: FILE_PATH,
		priority: 'project',
		subscribe: [{kind: 'schedule.cron', cron: '0 9 * * MON'}],
	});
	t.deepEqual(skill.subscribe, [
		{kind: 'schedule.cron', cron: '0 9 * * MON'},
	]);
});

test('subagentToSkill: description from subagent, source shape single-file', t => {
	const filePath = '/tmp/.nanocoder/agents/docs-agent.md';
	const skill = subagentToSkill(makeSubagent(), {
		filePath,
		priority: 'project',
	});
	t.is(skill.name, 'docs-agent');
	t.is(skill.description, 'Watch docs and refresh outputs.');
	t.is(skill.source.shape, 'single-file');
	t.is(skill.source.rootPath, filePath);
	t.is(skill.source.priority, 'project');
	t.is(skill.subagent?.subagent.name, 'docs-agent');
	t.is(skill.commands, undefined);
	t.is(skill.tools, undefined);
});

test('toolToSkill: description from tool.description, defaults visibility to global', t => {
	const filePath = '/tmp/.nanocoder/tools/gh_pr_diff.md';
	const skill = toolToSkill(makeTool(), {filePath, priority: 'personal'});
	t.is(skill.name, 'gh_pr_diff');
	t.is(skill.description, 'Open a PR diff.');
	t.is(skill.toolsVisibility, 'global');
	t.is(skill.tools?.[0]?.filePath, filePath);
});

test('toolToSkill: falls back to filename when tool has no description', t => {
	const filePath = '/tmp/.nanocoder/tools/noisy.md';
	const t1 = makeTool('');
	const skill = toolToSkill(t1, {filePath, priority: 'personal'});
	t.is(skill.description, 'noisy');
});

test('all adapters: built-in priority is preserved', t => {
	const filePath = '/whatever/foo.md';
	const skill = subagentToSkill(makeSubagent(), {
		filePath,
		priority: 'built-in',
	});
	t.is(skill.source.priority, 'built-in');
});
