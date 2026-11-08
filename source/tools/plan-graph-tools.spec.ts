import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {PlanStore} from '@/plans/storage';
import {SESSION_ARTIFACT_TOOLS, ToolManager} from '@/tools/tool-manager';
import {buildSystemPrompt, resetSectionCache} from '@/utils/prompt-builder';
import {createGetPlanTool} from './get-plan';
import {createUpdatePlanNodeTool} from './update-plan-node';

async function withPlan(
	run: (store: PlanStore) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-plan-tools-'));
	try {
		const store = new PlanStore(root);
		await store.createPlan({
			title: 'Auth refactor',
			nodes: [
				{id: 'db', title: 'Set up database'},
				{id: 'api', title: 'Build API', dependsOn: ['db'], agent: 'general'},
			],
		});
		await run(store);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
}

test('get_plan renders the active graph with ready and blocked work', async t => {
	await withPlan(async store => {
		await store.updatePlanNode('auth-refactor', 'db', {status: 'done'});
		const getPlan = createGetPlanTool(store);

		const result = await getPlan.tool.execute!({}, {} as never);
		t.true(typeof result === 'string');
		t.true(result.includes('Auth refactor'));
		t.true(result.includes('1/2 done'));
		t.true(result.includes('Ready now'));
		t.true(result.includes('api'));
		t.true(result.includes('agent: general'));
	});
});

test('get_plan explains how to create or locate a missing plan', async t => {
	await withPlan(async store => {
		const getPlan = createGetPlanTool(store);
		const missing = await getPlan.tool.execute!(
			{plan_id: 'does-not-exist'},
			{} as never,
		);
		t.true(typeof missing === 'string' && missing.includes('was not found'));
	});
});

test('update_plan_node gates dependents and keeps blocked reasons visible', async t => {
	await withPlan(async store => {
		const update = createUpdatePlanNodeTool(store);

		await t.throwsAsync(
			() =>
				update.tool.execute!(
					{node_id: 'api', status: 'doing'},
					{} as never,
				),
			{instanceOf: Error},
		);

		await update.tool.execute!({node_id: 'db', status: 'done'}, {} as never);
		const started = await update.tool.execute!(
			{node_id: 'api', status: 'doing'},
			{} as never,
		);
		t.true(typeof started === 'string' && started.includes('is now doing'));

		await t.throwsAsync(
			() =>
				update.tool.execute!(
					{node_id: 'api', status: 'blocked'},
					{} as never,
				),
			{instanceOf: Error},
		);

		const blocked = await update.tool.execute!(
			{
				node_id: 'api',
				status: 'blocked',
				blocked_reason: 'waiting for credentials',
			},
			{} as never,
		);
		t.true(
			typeof blocked === 'string' &&
				blocked.includes('waiting for credentials'),
		);
	});
});

test('update_plan_node requires an active plan and a mutation', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-plan-tools-'));
	try {
		const update = createUpdatePlanNodeTool(new PlanStore(root));
		await t.throwsAsync(
			() => update.tool.execute!({node_id: 'a'}, {} as never),
			{message: /No active plan graph/},
		);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('plan tools follow development-mode and subagent restrictions', t => {
	const manager = new ToolManager();
	const planMode = manager.getAvailableToolNames(undefined, 'plan');
	const normal = manager.getAvailableToolNames(undefined, 'normal');

	t.true(planMode.includes('get_plan'));
	t.false(planMode.includes('update_plan_node'));
	t.true(planMode.includes('write_plan'));

	t.true(normal.includes('get_plan'));
	t.true(normal.includes('update_plan_node'));

	t.true((SESSION_ARTIFACT_TOOLS as readonly string[]).includes('update_plan_node'));
});

test('buildSystemPrompt only adds plan-graph guidance when the tools exist', t => {
	resetSectionCache();

	const without = buildSystemPrompt('normal', undefined, ['read_file']);
	t.false(without.includes('PERSISTENT PLAN GRAPH'));

	const withGetPlan = buildSystemPrompt('normal', undefined, ['get_plan']);
	t.true(withGetPlan.includes('PERSISTENT PLAN GRAPH'));
	t.true(withGetPlan.includes('update_plan_node'));
});
