import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {PlanStore, PlanStoreError, parsePlanJsonl} from './storage.js';

async function withStore(
	run: (store: PlanStore, root: string) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-plans-'));
	try {
		await run(new PlanStore(root), root);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
}

test('createPlan writes JSONL and survives a new store', async t => {
	await withStore(async (store, root) => {
		const plan = await store.createPlan({
			title: 'Auth refactor',
			nodes: [
				{id: 'db', title: 'Set up database'},
				{id: 'api', title: 'Build API', dependsOn: ['db'], agent: 'general'},
			],
		});

		t.is(plan.id, 'auth-refactor');
		t.is(await store.getActivePlanId(), 'auth-refactor');

		const raw = await readFile(store.getPlanPath(plan.id), 'utf8');
		const lines = raw.trim().split('\n');
		t.is(lines.length, 3);
		const header = JSON.parse(lines[0] as string) as {type?: string};
		t.is(header.type, 'header');
		t.is((JSON.parse(lines[1] as string) as {id?: string}).id, 'db');
		t.is((JSON.parse(lines[2] as string) as {agent?: string}).agent, 'general');

		// A different process/store instance sees the same graph.
		const reopened = new PlanStore(root);
		const loaded = await reopened.getActivePlan();
		t.truthy(loaded);
		t.is(loaded?.title, 'Auth refactor');
		t.deepEqual(
			loaded?.nodes.map(node => node.id),
			['db', 'api'],
		);

		const gitignore = await readFile(
			join(root, '.nanocoder', '.gitignore'),
			'utf8',
		);
		t.true(gitignore.includes('/plans/'));
	});
});

test('replacePlan keeps the id and creation time but replaces nodes', async t => {
	await withStore(async store => {
		const original = await store.createPlan({
			title: 'Original',
			nodes: [{id: 'a', title: 'First'}],
		});

		const replaced = await store.replacePlan(original.id, {
			title: 'Renamed',
			nodes: [{id: 'b', title: 'Second'}],
		});

		t.is(replaced.id, original.id);
		t.is(replaced.createdAt, original.createdAt);
		t.is(replaced.title, 'Renamed');
		t.deepEqual(
			replaced.nodes.map(node => node.id),
			['b'],
		);
	});
});

test('updatePlanNode enforces dependencies and reasons', async t => {
	await withStore(async store => {
		const plan = await store.createPlan({
			title: 'Auth',
			nodes: [
				{id: 'db', title: 'Database'},
				{id: 'api', title: 'API', dependsOn: ['db']},
			],
		});

		await t.throwsAsync(
			() => store.updatePlanNode(plan.id, 'api', {status: 'doing'}),
			{instanceOf: Error},
		);

		await store.updatePlanNode(plan.id, 'db', {status: 'done'});
		const started = await store.updatePlanNode(plan.id, 'api', {
			status: 'doing',
			agent: 'general',
			checkpoint: 'auth-start',
		});
		t.is(started.node.status, 'doing');
		t.is(started.node.agent, 'general');
		t.is(started.node.checkpoint, 'auth-start');

		await t.throwsAsync(
			() => store.updatePlanNode(plan.id, 'api', {status: 'blocked'}),
			{instanceOf: Error},
		);

		const blocked = await store.updatePlanNode(plan.id, 'api', {
			status: 'blocked',
			blockedReason: 'waiting for credentials',
		});
		t.is(blocked.node.blockedReason, 'waiting for credentials');

		const resumed = await store.updatePlanNode(plan.id, 'api', {
			status: 'doing',
		});
		t.is(resumed.node.blockedReason, undefined);
	});
});

test('listPlans, setActivePlanId, and deletePlan maintain the index', async t => {
	await withStore(async store => {
		const first = await store.createPlan({
			title: 'First plan',
			nodes: [{id: 'a', title: 'A'}],
		});
		const second = await store.createPlan({
			title: 'First plan',
			nodes: [{id: 'b', title: 'B'}],
		});

		t.is(first.id, 'first-plan');
		t.is(second.id, 'first-plan-2');
		t.is((await store.listPlans()).length, 2);
		t.is(await store.getActivePlanId(), second.id);

		await store.setActivePlanId(first.id);
		t.is(await store.getActivePlanId(), first.id);
		t.is((await store.getActivePlan())?.title, 'First plan');

		t.true(await store.deletePlan(first.id));
		t.is(await store.getActivePlanId(), null);
		t.is((await store.listPlans()).length, 1);
		t.false(await store.deletePlan('missing-plan'));
	});
});

test('listPlans rebuilds a missing index from plan files', async t => {
	await withStore(async (store, root) => {
		await store.createPlan({
			title: 'Recovered',
			nodes: [{id: 'a', title: 'A'}],
		});
		await rm(store.getIndexPath(), {force: true});

		const summaries = await store.listPlans();
		t.is(summaries.length, 1);
		t.is(summaries[0]?.title, 'Recovered');
		const index = await readFile(
			join(root, '.nanocoder', 'plans', 'index.json'),
			'utf8',
		);
		t.truthy(JSON.parse(index));
	});
});

test('getActivePlan recovers a missing or corrupt index without losing plans', async t => {
	await withStore(async (store, root) => {
		const plan = await store.createPlan({
			title: 'Recoverable',
			nodes: [{id: 'a', title: 'A'}],
		});
		await rm(store.getIndexPath(), {force: true});

		const recovered = await new PlanStore(root).getActivePlan();
		t.is(recovered?.id, plan.id);

		await writeFile(store.getIndexPath(), '{invalid json', 'utf8');
		const recoveredAgain = await new PlanStore(root).getActivePlan();
		t.is(recoveredAgain?.id, plan.id);
	});
});

test('getActivePlan respects an explicitly disabled active plan', async t => {
	await withStore(async store => {
		await store.createPlan({
			title: 'Inactive',
			nodes: [{id: 'a', title: 'A'}],
		});
		await store.setActivePlanId(null);

		t.is(await store.getActivePlan(), null);
	});
});

test('invalid plan ids cannot escape the plans directory', async t => {
	await withStore(async store => {
		t.is(await store.loadPlan('../../etc/passwd'), null);
		t.false(await store.deletePlan('../outside'));
		t.throws(() => store.getPlanPath('../outside'), {
			instanceOf: PlanStoreError,
		});
	});
});

test('parsePlanJsonl reports malformed files clearly', async t => {
	await withStore(async store => {
		await store.createPlan({
			title: 'Broken',
			nodes: [{id: 'a', title: 'A'}],
		});
		const filePath = store.getPlanPath('broken');
		await writeFile(filePath, 'not json\n', 'utf8');

		await t.throwsAsync(() => store.loadPlan('broken'), {
			instanceOf: PlanStoreError,
		});
		t.throws(() => parsePlanJsonl('{"type":"node","id":"a","title":"A"}\n'), {
			instanceOf: PlanStoreError,
		});
	});
});
