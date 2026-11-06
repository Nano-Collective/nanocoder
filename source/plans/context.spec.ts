import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	appendActivePlanContext,
	renderPlanContextBlock,
} from './context.js';
import {PlanStore} from './storage.js';
import type {PlanGraph} from './types.js';

function plan(nodes: PlanGraph['nodes']): PlanGraph {
	return {
		id: 'auth',
		title: 'Auth refactor',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		nodes,
	};
}

const node = (
	id: string,
	title: string,
	overrides: Partial<PlanGraph['nodes'][number]> = {},
): PlanGraph['nodes'][number] => ({
	id,
	title,
	status: 'todo',
	dependsOn: [],
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	...overrides,
});

test('renderPlanContextBlock summarises progress, ready, waiting and blocked work', t => {
	const block = renderPlanContextBlock(
		plan([
			node('db', 'Set up database', {status: 'done'}),
			node('api', 'Build API', {dependsOn: ['db'], agent: 'general'}),
			node('ui', 'Build UI', {dependsOn: ['api']}),
			node('auth', 'Wire provider', {
				status: 'blocked',
				blockedReason: 'waiting for credentials',
			}),
		]),
	);

	t.true(block.includes('ACTIVE PLAN'));
	t.true(block.includes('1/4 done'));
	t.true(block.includes('Ready now: api'));
	t.true(block.includes('Waiting on dependencies: ui'));
	t.true(block.includes('Blocked: auth (waiting for credentials)'));
	t.true(block.includes('agent: general'));
	t.true(block.includes('Plan id: `auth`'));
});

test('renderPlanContextBlock caps the node list for very large plans', t => {
	const nodes = Array.from({length: 5}, (_, index) =>
		node(`n${index}`, `Node ${index}`),
	);
	const block = renderPlanContextBlock(plan(nodes), {maxNodes: 2});

	t.true(block.includes('n0'));
	t.true(block.includes('n1'));
	t.false(block.includes('n4 —'));
	t.true(block.includes('3 more node(s)'));
});

test('appendActivePlanContext is a no-op when no plan is active', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-plan-context-'));
	try {
		const prompt = 'BASE PROMPT';
		t.is(
			await appendActivePlanContext(prompt, new PlanStore(root)),
			prompt,
		);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('appendActivePlanContext appends the active plan from disk', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-plan-context-'));
	try {
		const store = new PlanStore(root);
		await store.createPlan({
			title: 'Resume me',
			nodes: [
				{id: 'a', title: 'First', status: 'done'},
				{id: 'b', title: 'Second', dependsOn: ['a']},
			],
		});

		// A fresh store models a new process resuming the session.
		const result = await appendActivePlanContext(
			'BASE PROMPT',
			new PlanStore(root),
		);

		t.true(result.startsWith('BASE PROMPT'));
		t.true(result.includes('ACTIVE PLAN'));
		t.true(result.includes('Resume me'));
		t.true(result.includes('1/2 done'));
		t.true(result.includes('Ready now: b'));
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('appendActivePlanContext degrades to the base prompt when the plan is unreadable', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-plan-context-'));
	try {
		const store = new PlanStore(root);
		const created = await store.createPlan({
			title: 'Broken plan',
			nodes: [{id: 'a', title: 'First'}],
		});
		await writeFile(store.getPlanPath(created.id), 'not json\n', 'utf8');

		// A corrupt plan file must never block a chat turn.
		t.is(await appendActivePlanContext('BASE', new PlanStore(root)), 'BASE');
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});
