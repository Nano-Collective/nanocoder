import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {ArtifactManager} from '@/artifacts/artifact-manager';
import {PlanStore} from '@/plans/storage';
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

test('write_plan validator rejects an empty node list but accepts content-only or nodes-only calls', async t => {
	const writePlan = createWritePlanTool(new ArtifactManager('/tmp/unused'));

	t.deepEqual(await writePlan.validator?.({content: '# Plan\n', nodes: []}), {
		valid: false,
		error: 'Plan graph needs at least one node',
	});
	t.deepEqual(await writePlan.validator?.({content: '# Plan\n'}), {
		valid: true,
	});
	t.deepEqual(await writePlan.validator?.({nodes: [{title: 'Do it'}]}), {
		valid: true,
	});
});

test('write_plan persists a graph without a session when there is no markdown artifact', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-write-plan-'));
	const store = new PlanStore(root);
	const writePlan = createWritePlanTool(new ArtifactManager(root), store);

	try {
		const result = await writePlan.tool.execute!(
			{nodes: [{id: 'only', title: 'Only graph'}]},
			undefined as never,
		);
		t.true(typeof result === 'string' && result.includes('Plan graph'));
		t.deepEqual(
			(await store.getActivePlan())?.nodes.map(node => node.id),
			['only'],
		);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
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

test('write_plan persists and replaces a dependency graph without changing content-only behaviour', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-write-plan-'));
	const manager = new ArtifactManager(root);
	const sessionId = '11111111-1111-4111-8111-111111111111';
	const store = new PlanStore(root);
	const writePlan = createWritePlanTool(manager, store);

	try {
		const first = await writePlan.tool.execute!(
			{
				content: '# Auth plan\n',
				title: 'Auth refactor',
				nodes: [
					{id: 'db', title: 'Set up database'},
					{
						id: 'api',
						title: 'Build API',
						depends_on: ['db'],
						agent: 'general',
					},
				],
			},
			{toolCallId: 'graph-1', messages: [], sessionId} as never,
		);

		t.true(typeof first === 'string' && first.includes('Plan graph'));
		t.is(
			await manager.readArtifact(sessionId, 'implementation_plan'),
			'# Auth plan\n',
		);

		const stored = await store.getActivePlan();
		t.is(stored?.id, 'auth-refactor');
		t.deepEqual(
			stored?.nodes.map(node => node.id),
			['db', 'api'],
		);
		t.deepEqual(stored?.nodes[1]?.dependsOn, ['db']);
		t.is(stored?.nodes[1]?.agent, 'general');

		// Omitting plan_id replaces the active graph rather than creating a new one.
		await writePlan.tool.execute!(
			{
				nodes: [{id: 'db', title: 'Set up database', status: 'done'}],
			},
			{toolCallId: 'graph-2', messages: [], sessionId} as never,
		);
		t.deepEqual(
			(await store.getActivePlan())?.nodes.map(node => node.id),
			['db'],
		);
		t.is((await store.listPlans()).length, 1);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});
