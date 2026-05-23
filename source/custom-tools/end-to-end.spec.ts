/**
 * End-to-end: load a real markdown file from a temp directory, register it
 * through ToolManager, and confirm it shows up in getAllTools() with the
 * right schema, validator, and mode-filtering behavior.
 *
 * The plan called out subagent integration as a load-bearing property of
 * the marketplace vision — a custom tool registered via ToolManager must
 * be discoverable through the same getAllTools() / getToolEntry() surface
 * that SubagentExecutor uses. We test that here.
 */

import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {ToolManager} from '@/tools/tool-manager';

console.log('\ncustom-tools/end-to-end.spec.ts');

let projectRoot: string;
let configDir: string;
let projectToolsDir: string;

test.before(() => {
	const root = join(tmpdir(), `nanocoder-custom-tools-e2e-${Date.now()}`);
	projectRoot = join(root, 'project');
	configDir = join(root, 'config');
	projectToolsDir = join(projectRoot, '.nanocoder', 'tools');
	mkdirSync(projectToolsDir, {recursive: true});
	mkdirSync(join(configDir, 'tools'), {recursive: true});
	process.env.NANOCODER_CONFIG_DIR = configDir;
});

test.after.always(() => {
	delete process.env.NANOCODER_CONFIG_DIR;
	if (projectRoot)
		rmSync(join(projectRoot, '..'), {recursive: true, force: true});
});

function writeTool(name: string, contents: string) {
	writeFileSync(join(projectToolsDir, name), contents, 'utf-8');
}

test.serial('custom tool appears in ToolManager registry', t => {
	writeTool(
		'list_files.md',
		`---
name: list_files_custom
description: List files in a directory
parameters:
  dir:
    type: string
    required: true
    description: directory to list
approval: never
---
ls {{ dir }}`,
	);

	const manager = new ToolManager();
	const {loaded, errors} = manager.initializeCustomTools(projectRoot);
	t.deepEqual(loaded, ['list_files_custom']);
	t.deepEqual(errors, []);
	t.true(manager.hasTool('list_files_custom'));
	t.true(manager.isCustomTool('list_files_custom'));

	const entry = manager.getToolEntry('list_files_custom');
	t.truthy(entry);
	t.truthy(entry?.formatter);
	t.truthy(entry?.validator);
	t.truthy(entry?.handler);
	t.true(entry?.readOnly);

	const allTools = manager.getAllTools();
	t.truthy(allTools.list_files_custom);
});

test.serial('custom tool name collision with built-in is rejected', t => {
	rmSync(projectToolsDir, {recursive: true, force: true});
	mkdirSync(projectToolsDir, {recursive: true});

	writeTool(
		'collide.md',
		`---
name: read_file
description: collides
---
echo x`,
	);

	const manager = new ToolManager();
	const {loaded, errors} = manager.initializeCustomTools(projectRoot);
	t.is(loaded.length, 0);
	t.is(errors.length, 1);
	t.regex(errors[0]?.error ?? '', /collides with a built-in/);
});

test.serial('plan mode filters out non-readonly custom tools', t => {
	rmSync(projectToolsDir, {recursive: true, force: true});
	mkdirSync(projectToolsDir, {recursive: true});

	writeTool(
		'safe.md',
		`---
name: safe_listing
description: read-only listing
approval: never
read_only: true
---
ls`,
	);
	writeTool(
		'risky.md',
		`---
name: risky_op
description: mutates things
approval: always
---
rm`,
	);

	const manager = new ToolManager();
	const {loaded} = manager.initializeCustomTools(projectRoot);
	t.deepEqual(loaded.sort(), ['risky_op', 'safe_listing']);

	const planNames = manager.getAvailableToolNames(undefined, 'plan');
	t.true(planNames.includes('safe_listing'));
	t.false(planNames.includes('risky_op'));

	const normalNames = manager.getAvailableToolNames(undefined, 'normal');
	t.true(normalNames.includes('safe_listing'));
	t.true(normalNames.includes('risky_op'));
});

test.serial('headless mode excludes any custom tool needing approval', t => {
	rmSync(projectToolsDir, {recursive: true, force: true});
	mkdirSync(projectToolsDir, {recursive: true});

	writeTool(
		'auto.md',
		`---
name: auto_safe
description: no approval needed
approval: never
---
echo ok`,
	);
	writeTool(
		'prompt.md',
		`---
name: needs_prompt
description: requires approval
approval: always
---
echo ok`,
	);

	const manager = new ToolManager();
	manager.initializeCustomTools(projectRoot);

	const headlessNames = manager.getAvailableToolNames(
		undefined,
		'headless',
	);
	t.true(headlessNames.includes('auto_safe'));
	t.false(headlessNames.includes('needs_prompt'));
});

test.serial(
	'custom tool is reachable through the exact ToolManager methods SubagentExecutor uses',
	async t => {
		// SubagentExecutor (source/subagents/subagent-executor.ts) accesses tools
		// only through these ToolManager methods:
		//   :200  toolManager.getAllTools()           — to list tool names
		//   :235  toolManager.getAllToolsWithoutExecute()
		//   :481  toolManager.getToolEntry(name)      — to check approval policy
		//   :499  toolManager.getToolHandler(name)    — to execute
		// If a custom tool is registered into ToolManager and shows up via every
		// one of these surfaces, subagents see it for free. This test pins that
		// behavior so a future refactor of the registry can't silently regress it.
		rmSync(projectToolsDir, {recursive: true, force: true});
		mkdirSync(projectToolsDir, {recursive: true});

		writeTool(
			'echo.md',
			`---
name: subagent_visible_tool
description: A custom tool a subagent should be able to call.
parameters:
  msg:
    type: string
    required: true
approval: never
---
echo {{ msg }}`,
		);

		const manager = new ToolManager();
		const {loaded, errors} = manager.initializeCustomTools(projectRoot);
		t.deepEqual(loaded, ['subagent_visible_tool']);
		t.is(errors.length, 0);

		t.truthy(manager.getAllTools().subagent_visible_tool);
		t.truthy(manager.getAllToolsWithoutExecute().subagent_visible_tool);

		const entry = manager.getToolEntry('subagent_visible_tool');
		t.truthy(entry);
		t.truthy(entry?.tool);

		const handler = manager.getToolHandler('subagent_visible_tool');
		t.truthy(handler);
		// And invoking it through ToolManager's handler path actually runs the
		// shell body, proving the wiring all the way through is intact.
		const result = await handler!({msg: 'hello-subagent'});
		t.is(result, 'EXIT_CODE: 0\nhello-subagent');
	},
);

test.serial('disabledTools filter applies to custom tools', t => {
	rmSync(projectToolsDir, {recursive: true, force: true});
	mkdirSync(projectToolsDir, {recursive: true});

	writeTool(
		'thing.md',
		`---
name: my_custom_thing
description: a thing
approval: never
---
echo`,
	);

	const manager = new ToolManager();
	manager.initializeCustomTools(projectRoot);

	const names = manager.getAvailableToolNames(undefined, 'normal', [
		'my_custom_thing',
	]);
	t.false(names.includes('my_custom_thing'));
});
