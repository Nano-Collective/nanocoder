import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {ArtifactManager} from '@/artifacts/artifact-manager';
import {ToolManager} from '@/tools/tool-manager';
import {ToolRegistry} from '@/tools/tool-registry';
import {getToolJsonSchema} from '@/utils/schema-validate';
import {createWritePlanTool} from './write-plan';

test('write_plan replaces the current session plan without accepting a path', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-write-plan-'));
	const manager = new ArtifactManager(root);
	const sessionId = '11111111-1111-4111-8111-111111111111';
	const writePlan = createWritePlanTool(manager);

	try {
		await writePlan.tool.execute!(
			{content: '# Initial plan\n'},
			{toolCallId: 'first', messages: [], sessionId} as never,
		);
		await writePlan.tool.execute!(
			{content: '# Final plan\n'},
			{toolCallId: 'second', messages: [], sessionId} as never,
		);

		t.is(
			await manager.readArtifact(sessionId, 'implementation_plan'),
			'# Final plan\n',
		);
		const schema = getToolJsonSchema(writePlan.tool);
		t.false('path' in (schema?.properties ?? {}));
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('write_plan reports a missing active session clearly', async t => {
	const writePlan = createWritePlanTool(new ArtifactManager('/tmp/unused'));

	await t.throwsAsync(
		() =>
			writePlan.tool.execute!(
				{content: '# Plan\n'},
				undefined as never,
			),
		{message: 'write_plan requires an active session'},
	);
});

test('write_plan is exposed only in plan mode', t => {
	const manager = new ToolManager();

	t.true(manager.getAvailableToolNames(undefined, 'plan').includes('write_plan'));
	for (const mode of ['normal', 'auto-accept', 'yolo', 'headless'] as const) {
		t.false(
			manager.getAvailableToolNames(undefined, mode).includes('write_plan'),
		);
	}
});

test('tool registry forwards the active session to write_plan', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-write-plan-'));
	const manager = new ArtifactManager(root);
	const sessionId = '11111111-1111-4111-8111-111111111111';
	const registry = ToolRegistry.fromToolExports([createWritePlanTool(manager)]);

	try {
		await registry
			.getHandler('write_plan')?.({content: '# Registry plan\n'}, {sessionId});

		t.is(
			await manager.readArtifact(sessionId, 'implementation_plan'),
			'# Registry plan\n',
		);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});
