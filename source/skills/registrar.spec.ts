import test from 'ava';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {EventRouter} from '@/events/event-router';
import type {Event, Subscription, SubscriptionDispatcher} from '@/events/types';
import {SubagentLoader} from '@/subagents/subagent-loader';
import {ToolManager} from '@/tools/tool-manager';
import type {CustomCommand} from '@/types/commands';
import {jsonSchema, tool, type ToolEntry} from '@/types/core';
import type {Skill} from '@/types/skills';
import {registerSkills} from './registrar';

console.log(`\nregistrar.spec.ts`);

function captureDispatcher(): {
	dispatcher: SubscriptionDispatcher;
	calls: Array<{sub: Subscription; event: Event}>;
} {
	const calls: Array<{sub: Subscription; event: Event}> = [];
	return {
		calls,
		dispatcher: {
			dispatch(sub, event) {
				calls.push({sub, event});
			},
		},
	};
}

function makeDeps() {
	const {dispatcher, calls} = captureDispatcher();
	return {
		toolManager: new ToolManager(),
		commandLoader: new CustomCommandLoader('/tmp/registrar-spec'),
		subagentLoader: new SubagentLoader('/tmp/registrar-spec'),
		eventRouter: new EventRouter(dispatcher),
		dispatchCalls: calls,
	};
}

function makeCommand(name: string, path: string): CustomCommand {
	return {
		name,
		path,
		fullName: name,
		metadata: {description: `command ${name}`},
		content: 'body',
	};
}

function makeToolEntry(name: string): ToolEntry {
	return {
		name,
		tool: tool({
			description: `tool ${name}`,
			inputSchema: jsonSchema({type: 'object', properties: {}}),
			execute: async () => 'ok',
		}),
		handler: async () => 'ok',
	};
}

function bundleSkill(overrides: Partial<Skill> = {}): Skill {
	return {
		name: 'k8s',
		description: 'k8s helpers',
		toolsVisibility: 'scoped',
		source: {priority: 'project', shape: 'bundle', rootPath: '/skills/k8s'},
		...overrides,
	};
}

function singleFileCommandSkill(name: string, path: string): Skill {
	return {
		name,
		description: `flat ${name}`,
		toolsVisibility: 'global',
		source: {priority: 'project', shape: 'single-file', rootPath: path},
		commands: [{command: makeCommand(name, path), filePath: path}],
	};
}

test('registers a flat command into the CustomCommandLoader', t => {
	const deps = makeDeps();
	const skill = singleFileCommandSkill(
		'weekly-report',
		'/p/.nanocoder/commands/weekly-report.md',
	);
	const r = registerSkills([skill], deps);
	t.deepEqual(r.collisions, []);
	t.deepEqual(r.registered, ['weekly-report']);
	t.is(deps.commandLoader.getCommand('weekly-report')?.name, 'weekly-report');
	// /commands listing reads getAllCommands(); the command must show up there
	t.true(
		deps.commandLoader.getAllCommands().some(c => c.name === 'weekly-report'),
	);
});

test('namespaced bundle commands are findable via fullName + listed by /commands', t => {
	const deps = makeDeps();
	const skill: Skill = {
		name: 'k8s',
		description: 'k8s helpers',
		toolsVisibility: 'scoped',
		source: {priority: 'project', shape: 'bundle', rootPath: '/skills/k8s'},
		commands: [
			{
				command: {
					name: 'status',
					path: '/skills/k8s/commands/status.md',
					namespace: 'k8s',
					fullName: 'k8s:status',
					metadata: {description: 'show status'},
					content: 'body',
				},
				filePath: '/skills/k8s/commands/status.md',
			},
			{
				command: {
					name: 'logs',
					path: '/skills/k8s/commands/logs.md',
					namespace: 'k8s',
					fullName: 'k8s:logs',
					metadata: {description: 'show logs'},
					content: 'body',
				},
				filePath: '/skills/k8s/commands/logs.md',
			},
		],
	};
	const r = registerSkills([skill], deps);
	t.deepEqual(r.collisions, []);

	// Dispatch lookup by fullName must succeed
	t.is(deps.commandLoader.getCommand('k8s:status')?.fullName, 'k8s:status');
	t.is(deps.commandLoader.getCommand('k8s:logs')?.fullName, 'k8s:logs');

	// /commands listing must include both
	const names = deps.commandLoader.getAllCommands().map(c => c.fullName).sort();
	t.deepEqual(names, ['k8s:logs', 'k8s:status']);
});

test('registers a subagent with ownerSkill tag into SubagentLoader', async t => {
	const deps = makeDeps();
	const skill: Skill = {
		name: 'docs',
		description: 'docs',
		toolsVisibility: 'global',
		source: {
			priority: 'project',
			shape: 'single-file',
			rootPath: '/p/.nanocoder/agents/docs-agent.md',
		},
		subagent: {
			subagent: {
				name: 'docs-agent',
				description: 'watches docs',
				systemPrompt: 'You watch docs.',
			},
			filePath: '/p/.nanocoder/agents/docs-agent.md',
		},
	};
	const r = registerSkills([skill], deps);
	t.deepEqual(r.collisions, []);

	const loaded = await deps.subagentLoader.getSubagent('docs-agent');
	t.truthy(loaded);
	t.is(loaded?.ownerSkill, 'docs');
});

test('registers scoped bundle tools and tags them with ownerSkill + scoped', t => {
	const deps = makeDeps();
	const skill = bundleSkill({
		tools: [
			{
				tool: makeToolEntry('k8s_pods'),
				filePath: '/skills/k8s/tools/k8s_pods.md',
			},
		],
	});
	const r = registerSkills([skill], deps);
	t.deepEqual(r.collisions, []);

	t.true(deps.toolManager.hasTool('k8s_pods'));
	t.is(deps.toolManager.getOwnerSkill('k8s_pods'), 'k8s');
});

test('global view of getAllTools hides scoped tools', t => {
	const deps = makeDeps();
	const skill = bundleSkill({
		tools: [
			{
				tool: makeToolEntry('k8s_pods'),
				filePath: '/skills/k8s/tools/k8s_pods.md',
			},
		],
	});
	registerSkills([skill], deps);

	const globalView = deps.toolManager.getAllTools();
	t.false('k8s_pods' in globalView);

	const ownerView = deps.toolManager.getAllTools({forSkill: 'k8s'});
	t.true('k8s_pods' in ownerView);
});

test('single-file tools (toolsVisibility=global) remain visible globally', t => {
	const deps = makeDeps();
	const skill: Skill = {
		name: 'gh_pr_diff',
		description: 'PR diff',
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
	t.true('gh_pr_diff' in deps.toolManager.getAllTools());
});

test('command-name collision is reported, the second registration is skipped', t => {
	const deps = makeDeps();
	const a = singleFileCommandSkill('same', '/a/.nanocoder/commands/same.md');
	const b = singleFileCommandSkill('same', '/b/.nanocoder/commands/same.md');

	const r = registerSkills([a, b], deps);
	t.is(r.collisions.length, 1);
	t.is(r.collisions[0]?.kind, 'command');
	t.regex(r.collisions[0]?.message ?? '', /collides/);
	// First one wins
	t.is(deps.commandLoader.getCommand('same')?.path, '/a/.nanocoder/commands/same.md');
});

test('subscriptions are registered with the event router', async t => {
	const deps = makeDeps();
	const skill: Skill = {
		name: 'docs',
		description: 'docs',
		toolsVisibility: 'global',
		source: {
			priority: 'project',
			shape: 'single-file',
			rootPath: '/p/.nanocoder/agents/docs-agent.md',
		},
		subagent: {
			subagent: {
				name: 'docs-agent',
				description: 'docs',
				systemPrompt: 'sp',
			},
			filePath: '/p/.nanocoder/agents/docs-agent.md',
		},
		subscribe: [
			{
				kind: 'file.changed',
				target: 'agent:docs-agent',
				paths: ['docs/**'],
			},
		],
	};
	const r = registerSkills([skill], deps);
	t.deepEqual(r.collisions, []);
	t.is(r.subscriptionIds.length, 1);

	await deps.eventRouter.emit({
		kind: 'file.changed',
		payload: {file: 'docs/intro.md', eventKind: 'change'},
		at: Date.now(),
	});
	t.is(deps.dispatchCalls.length, 1);
	t.is(deps.dispatchCalls[0]?.sub.id, r.subscriptionIds[0]);
});
