import test from 'ava';
import {groupTools} from './tools.js';
import {resetSkillRegistry, setLoadedSkills} from '@/skills/skill-registry';
import type {ToolManager} from '@/tools/tool-manager';

console.log('\ntools.spec.ts');

interface MockConfig {
	toolNames: string[];
	customTools?: Record<string, {source: 'personal' | 'project'}>;
	ownerSkills?: Record<string, string>;
	mcpTools?: Record<string, string>;
}

function createMockToolManager(config: MockConfig): ToolManager {
	return {
		getToolNames: () => config.toolNames,
		isCustomTool: (name: string) =>
			!!config.customTools && name in config.customTools,
		getCustomToolInfo: (name: string) =>
			config.customTools?.[name]
				? {source: config.customTools[name].source}
				: undefined,
		getOwnerSkill: (name: string) => config.ownerSkills?.[name],
		getMCPToolInfo: (name: string) =>
			config.mcpTools && name in config.mcpTools
				? {isMCPTool: true, serverName: config.mcpTools[name]}
				: {isMCPTool: false},
	} as unknown as ToolManager;
}

test.beforeEach(() => {
	resetSkillRegistry();
});

test.serial('groupTools - built-in tools land in builtin group', t => {
	const tm = createMockToolManager({
		toolNames: ['read_file', 'execute_bash'],
	});
	const r = groupTools(tm);

	t.deepEqual(r.builtin, ['execute_bash', 'read_file']);
	t.is(r.custom.length, 0);
	t.is(r.mcp.length, 0);
});

test.serial('groupTools - flat custom tools land in custom with source', t => {
	const tm = createMockToolManager({
		toolNames: ['list_pwd'],
		customTools: {list_pwd: {source: 'project'}},
	});
	const r = groupTools(tm);

	t.is(r.custom.length, 1);
	t.deepEqual(r.custom[0], {name: 'list_pwd', source: 'project'});
	t.is(r.builtin.length, 0);
});

test.serial(
	'groupTools - bundle skill tools (ownerSkill tag) land in custom with skill source + tag',
	t => {
		setLoadedSkills({
			skills: [
				{
					name: 'k8s',
					description: '',
					source: {shape: 'bundle', priority: 'project'},
				} as never,
			],
			loadErrors: [],
			collisions: [],
		});

		const tm = createMockToolManager({
			toolNames: ['k8s_pods'],
			ownerSkills: {k8s_pods: 'k8s'},
		});
		const r = groupTools(tm);

		t.is(r.custom.length, 1);
		t.is(r.custom[0].name, 'k8s_pods');
		t.is(r.custom[0].source, 'project');
		t.is(r.custom[0].ownerSkill, 'k8s');
		t.is(r.builtin.length, 0);
	},
);

test.serial('groupTools - MCP tools land in mcp group with server name', t => {
	const tm = createMockToolManager({
		toolNames: ['my_mcp_tool'],
		mcpTools: {my_mcp_tool: 'my-server'},
	});
	const r = groupTools(tm);

	t.is(r.mcp.length, 1);
	t.deepEqual(r.mcp[0], {name: 'my_mcp_tool', server: 'my-server'});
});

test.serial(
	'groupTools - bundle tool whose owner skill is missing falls back to project source',
	t => {
		setLoadedSkills({skills: [], loadErrors: [], collisions: []});

		const tm = createMockToolManager({
			toolNames: ['orphan_tool'],
			ownerSkills: {orphan_tool: 'gone'},
		});
		const r = groupTools(tm);

		t.is(r.custom.length, 1);
		t.is(r.custom[0].source, 'project');
		t.is(r.custom[0].ownerSkill, 'gone');
	},
);

test.serial(
	'groupTools - mixed: built-in, flat custom, bundle, and MCP coexist correctly',
	t => {
		setLoadedSkills({
			skills: [
				{
					name: 'k8s',
					description: '',
					source: {shape: 'bundle', priority: 'project'},
				} as never,
			],
			loadErrors: [],
			collisions: [],
		});

		const tm = createMockToolManager({
			toolNames: [
				'read_file',
				'list_pwd',
				'k8s_pods',
				'mcp_search',
				'execute_bash',
			],
			customTools: {list_pwd: {source: 'project'}},
			ownerSkills: {k8s_pods: 'k8s'},
			mcpTools: {mcp_search: 'docs'},
		});
		const r = groupTools(tm);

		t.deepEqual(r.builtin, ['execute_bash', 'read_file']);
		t.is(r.custom.length, 2);
		t.true(r.custom.some(x => x.name === 'list_pwd' && !x.ownerSkill));
		t.true(r.custom.some(x => x.name === 'k8s_pods' && x.ownerSkill === 'k8s'));
		t.is(r.mcp.length, 1);
		t.is(r.mcp[0].server, 'docs');
	},
);
