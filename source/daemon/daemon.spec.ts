import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {ToolManager} from '@/tools/tool-manager';
import {startDaemon} from './daemon';
import {getLockfilePath} from './lockfile';

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

test.serial('stop cancels active runs and waits for cleanup before releasing resources', async t => {
	t.timeout(10_000);
	const root = await mkdtemp(join(tmpdir(), 'daemon-drain-'));
	const commands = join(root, '.nanocoder', 'commands');
	await mkdir(commands, {recursive: true});
	await writeFile(
		join(commands, 'probe.md'),
		'---\nname: probe\ndescription: probe\nsubscribe:\n  - kind: file.changed\n    paths: [trigger.txt]\n---\nprobe\n',
	);
	let started!: () => void;
	const runStarted = new Promise<void>(resolve => {
		started = resolve;
	});
	let finish!: () => void;
	const cleanup = new Promise<void>(resolve => {
		finish = resolve;
	});
	let signal: AbortSignal | undefined;
	let disconnected = false;
	let activityReported = false;
	const toolManager = new ToolManager();
	toolManager.disconnectMCP = async () => {
		disconnected = true;
	};
	const handle = await startDaemon({
		projectRoot: root,
		toolManager,
		buildExecutor: () => ({
			async execute(task, abortSignal) {
				signal = abortSignal;
				started();
				await cleanup;
				await writeFile(join(root, 'artifact.txt'), 'complete');
				return {
					subagentName: task.subagent_type,
					success: false,
					output: '',
					error: 'Aborted',
					executionTimeMs: 0,
				};
			},
		}),
		onActivity: () => {
			activityReported = true;
		},
	});
	try {
		await writeFile(join(root, 'trigger.txt'), 'start');
		await runStarted;
		let stopped = false;
		const stopping = handle.stop();
		void stopping.then(() => {
			stopped = true;
		});
		t.is(handle.stop(), stopping);
		await new Promise(resolve => setTimeout(resolve, 20));
		t.true(signal?.aborted ?? false);
		t.false(stopped);
		t.false(disconnected);
		t.true(existsSync(getLockfilePath(root)));
		finish();
		await stopping;
		t.true(activityReported);
		t.true(disconnected);
		t.false(existsSync(getLockfilePath(root)));
		t.is(await readFile(join(root, 'artifact.txt'), 'utf-8'), 'complete');
	} finally {
		finish();
		await handle.stop();
		await rm(root, {recursive: true, force: true});
	}
});
