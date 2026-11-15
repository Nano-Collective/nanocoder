import test from 'ava';
import {getAlwaysAllowedTools} from '@/acp/acp-approval';
import {getAppConfig} from '@/config/index';
import {resolveToolApproval} from '@/tools/approval-policy';
import {ToolManager} from '@/tools/tool-manager';

console.log('\nacp-approval.spec.ts');

type Tools = Parameters<typeof getAlwaysAllowedTools>[0];

// `prompting` tools ask in normal mode, `skipping` ones do not (a read-only
// default). `mcp` maps a server tool to whether its server allow-lists it.
const fakeTools = (
	prompting: string[],
	skipping: string[] = [],
	mcp: Record<string, boolean> = {},
): Tools =>
	({
		getAvailableToolNames: () => [
			...prompting,
			...skipping,
			...Object.keys(mcp),
		],
		getMCPToolInfo: (name: string) => ({isMCPTool: name in mcp}),
		getToolEntry: (name: string) => ({
			approval: name in mcp ? !mcp[name] : !skipping.includes(name),
		}),
	}) as unknown as Tools;

test('getAlwaysAllowedTools - reports offered tools in the top-level alwaysAllow', async t => {
	const tools = fakeTools(['write_file', 'execute_bash', 'git_commit']);
	t.deepEqual(
		await getAlwaysAllowedTools(tools, 'normal', ['execute_bash', 'git_commit']),
		['execute_bash', 'git_commit'],
	);
});

test('getAlwaysAllowedTools - reports nothing when no allow-list applies', async t => {
	const tools = fakeTools(['write_file'], ['read_file'], {delete_dir: false});
	t.deepEqual(await getAlwaysAllowedTools(tools, 'normal', []), []);
});

test('getAlwaysAllowedTools - ignores allow-listed tools that are not offered', async t => {
	const tools = fakeTools(['write_file']);
	t.deepEqual(await getAlwaysAllowedTools(tools, 'normal', ['browser']), []);
});

test('getAlwaysAllowedTools - reports MCP tools their server allow-lists', async t => {
	const tools = fakeTools(['write_file'], [], {
		list_dir: true,
		delete_dir: false,
	});
	t.deepEqual(await getAlwaysAllowedTools(tools, 'normal', []), ['list_dir']);
});

test('getAlwaysAllowedTools - agrees with the approval resolver for every tool', async t => {
	const tools = fakeTools(['write_file', 'execute_bash'], [], {
		list_dir: true,
		delete_dir: false,
	});
	const alwaysAllow = ['execute_bash'];
	const reported = await getAlwaysAllowedTools(tools, 'normal', alwaysAllow);

	for (const name of tools.getAvailableToolNames()) {
		const prompts = await resolveToolApproval(
			name,
			tools.getToolEntry(name),
			undefined,
			{mode: 'normal', alwaysAllow},
		);
		t.is(reported.includes(name), !prompts, name);
	}
});

test.serial('getAlwaysAllowedTools - leaves out tools the session is not offered', async t => {
	const config = getAppConfig();
	const manager = new ToolManager();
	const alwaysAllow = ['read_file', 'write_file'];
	const run = async (mode: 'auto-accept' | 'plan') =>
		(await getAlwaysAllowedTools(manager, mode, alwaysAllow)).sort();

	t.deepEqual(await run('auto-accept'), ['read_file', 'write_file']);
	t.deepEqual(await run('plan'), ['read_file']);

	const previous = config.disabledTools;
	config.disabledTools = ['read_file'];
	try {
		t.deepEqual(await run('auto-accept'), ['write_file']);
	} finally {
		config.disabledTools = previous;
	}
});

test('getAlwaysAllowedTools - leaves out tools the session turned off', async t => {
	const manager = new ToolManager();
	const alwaysAllow = ['read_file', 'write_file'];

	t.deepEqual(
		(
			await getAlwaysAllowedTools(manager, 'auto-accept', alwaysAllow, [
				'write_file',
			])
		).sort(),
		['read_file'],
	);
});
