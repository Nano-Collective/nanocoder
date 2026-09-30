import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {ToolManager} from '@/tools/tool-manager';
import {startDaemon} from './daemon';

// Triggered runs execute against the tool registry the entry hands its
// executor factory. The daemon used to build a second registry for the skill
// pipeline, so a bundle's own tools were registered where no triggered agent
// could see them.
test.serial('startDaemon registers skill tools into the tool manager it is given', async t => {
	const root = await mkdtemp(join(tmpdir(), 'daemon-tools-'));
	const bundle = join(root, '.nanocoder', 'skills', 'probe');
	await mkdir(join(bundle, 'tools'), {recursive: true});
	await mkdir(join(bundle, 'agents'), {recursive: true});
	await writeFile(
		join(bundle, 'skill.yaml'),
		'name: probe\ndescription: probe\nversion: 0.1.0\n',
	);
	await writeFile(
		join(bundle, 'agents', 'probe-agent.md'),
		'---\nname: probe-agent\ndescription: probe\n---\nprobe\n',
	);
	await writeFile(
		join(bundle, 'tools', 'probe_tool.md'),
		'---\nname: probe_tool\ndescription: probe\napproval: never\nread_only: true\n---\necho probe\n',
	);

	const toolManager = new ToolManager();
	const handle = await startDaemon({
		projectRoot: root,
		toolManager,
		buildExecutor: () => ({
			execute: async () => ({success: true, output: '', toolCalls: 0}) as never,
		}),
	});
	try {
		t.truthy(toolManager.getToolEntry('probe_tool'));
	} finally {
		await handle.stop();
		await rm(root, {recursive: true, force: true});
	}
});
