import test from 'ava';
import {
	buildPlanNodes,
	computePlanStats,
	getReadyNodes,
	getWaitingNodes,
	MAX_PLAN_NODES,
	orderPlanNodes,
	slugifyPlanId,
	summarizePlan,
	uniqueNodeId,
	validatePlanGraph,
} from './graph.js';
import type {PlanGraph, PlanNode, PlanNodeInput} from './types.js';

const NOW = '2026-01-01T00:00:00.000Z';

function graph(inputs: PlanNodeInput[], id = 'auth'): PlanGraph {
	return {
		id,
		title: 'Auth refactor',
		createdAt: NOW,
		updatedAt: NOW,
		nodes: buildPlanNodes(inputs, NOW),
	};
}

function node(
	id: string,
	title: string,
	overrides: Partial<PlanNode> = {},
): PlanNode {
	return {
		id,
		title,
		status: 'todo',
		dependsOn: [],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

test('buildPlanNodes assigns stable unique ids and normalises fields', t => {
	const nodes = buildPlanNodes(
		[
			{title: 'Set up database'},
			{title: 'Set up database'},
			{id: 'api', title: ' Build API ', dependsOn: ['set-up-database', 'set-up-database'], agent: 'general'},
		],
		NOW,
	);

	t.deepEqual(
		nodes.map(item => item.id),
		['set-up-database', 'set-up-database-2', 'api'],
	);
	t.is(nodes[2]?.title, 'Build API');
	t.deepEqual(nodes[2]?.dependsOn, ['set-up-database']);
	t.is(nodes[2]?.status, 'todo');
	t.is(nodes[2]?.agent, 'general');
	t.is(nodes[0]?.createdAt, NOW);

	const multiline = buildPlanNodes([{title: '  Line one\nline two  '}], NOW);
	t.is(multiline[0]?.title, 'Line one line two');
});

test('slugifyPlanId keeps ids path-safe and non-empty', t => {
	t.is(slugifyPlanId('Auth Refactor / v2'), 'auth-refactor-v2');
	t.is(slugifyPlanId('  ...  '), 'plan');
	t.is(slugifyPlanId('../../etc/passwd'), 'etc-passwd');
	t.is(uniqueNodeId('Same', []), 'same');
	t.is(uniqueNodeId('Same', ['same']), 'same-2');
});

test('validatePlanGraph accepts a well-formed DAG', t => {
	const result = validatePlanGraph(
		graph([
			{id: 'db', title: 'Set up database'},
			{id: 'api', title: 'Build API', dependsOn: ['db']},
		]),
	);

	t.true(result.valid);
});

test('validatePlanGraph rejects duplicate ids, missing dependencies and self-dependency', t => {
	t.false(
		validatePlanGraph(graph([{id: 'a', title: 'A'}, {id: 'a', title: 'B'}]))
			.valid,
	);
	t.false(
		validatePlanGraph(
			graph([{id: 'a', title: 'A', dependsOn: ['missing']}]),
		).valid,
	);
	t.false(
		validatePlanGraph(
			graph([{id: 'a', title: 'A', dependsOn: ['a']}]),
		).valid,
	);
});

test('validatePlanGraph rejects cycles', t => {
	const result = validatePlanGraph(
		graph([
			{id: 'a', title: 'A', dependsOn: ['b']},
			{id: 'b', title: 'B', dependsOn: ['a']},
		]),
	);

	t.false(result.valid);
	if (!result.valid) t.regex(result.error, /cycle/i);
});

test('validatePlanGraph requires a reason for blocked nodes and completion gating', t => {
	const missingReason = validatePlanGraph(
		graph([{id: 'a', title: 'A', status: 'blocked'}]),
	);
	t.false(missingReason.valid);

	const withReason = validatePlanGraph(
		graph([
			{id: 'a', title: 'A', status: 'blocked', blockedReason: 'waiting for keys'},
		]),
	);
	t.true(withReason.valid);

	const prematureDone = validatePlanGraph(
		graph([
			{id: 'a', title: 'A'},
			{id: 'b', title: 'B', status: 'done', dependsOn: ['a']},
		]),
	);
	t.false(prematureDone.valid);

	const prematureDoing = validatePlanGraph(
		graph([
			{id: 'a', title: 'A'},
			{id: 'b', title: 'B', status: 'doing', dependsOn: ['a']},
		]),
	);
	t.false(prematureDoing.valid);
});

test('validatePlanGraph bounds the graph size', t => {
	const tooMany = graph(
		Array.from({length: MAX_PLAN_NODES + 1}, (_, index) => ({
			id: `n${index}`,
			title: `Node ${index}`,
		})),
	);
	t.false(validatePlanGraph(tooMany).valid);
	t.true(validatePlanGraph(graph([{title: 'One'}])).valid);
	t.false(validatePlanGraph({...graph([{title: 'One'}]), nodes: []}).valid);
});

test('ready and waiting sets reflect dependency completion', t => {
	const nodes: PlanNode[] = [
		node('a', 'A', {status: 'done'}),
		node('b', 'B', {dependsOn: ['a']}),
		node('c', 'C', {dependsOn: ['b']}),
		node('d', 'D', {status: 'blocked', blockedReason: 'keys', dependsOn: ['a']}),
	];

	t.deepEqual(
		getReadyNodes(nodes).map(item => item.id),
		['b'],
	);
	t.deepEqual(
		getWaitingNodes(nodes).map(item => item.id),
		['c'],
	);
	t.deepEqual(computePlanStats(nodes), {
		total: 4,
		todo: 2,
		doing: 0,
		done: 1,
		blocked: 1,
	});
});

test('orderPlanNodes puts dependencies before dependents', t => {
	const nodes: PlanNode[] = [
		node('c', 'C', {dependsOn: ['b']}),
		node('a', 'A'),
		node('b', 'B', {dependsOn: ['a']}),
	];

	t.deepEqual(
		orderPlanNodes(nodes).map(item => item.id),
		['a', 'b', 'c'],
	);
});

test('summarizePlan reports progress for the plan index', t => {
	const plan = graph([
		{id: 'a', title: 'A', status: 'done'},
		{id: 'b', title: 'B', status: 'doing'},
	]);

	t.deepEqual(summarizePlan(plan), {
		id: 'auth',
		title: 'Auth refactor',
		total: 2,
		done: 1,
		doing: 1,
		blocked: 0,
		updatedAt: NOW,
	});
});
