import type {
	PlanGraph,
	PlanNode,
	PlanNodeInput,
	PlanStats,
	PlanSummary,
	PlanValidationResult,
} from './types.js';
import {isPlanNodeStatus} from './types.js';

/** Hard cap so one runaway plan cannot make the JSONL unreadable. */
export const MAX_PLAN_NODES = 200;
const MAX_PLAN_TITLE_LENGTH = 200;
const MAX_NODE_TITLE_LENGTH = 300;
const MAX_NODE_DESCRIPTION_LENGTH = 4000;
const MAX_NODE_ID_LENGTH = 64;

const PLAN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isValidPlanId(id: unknown): id is string {
	return (
		typeof id === 'string' &&
		id.length > 0 &&
		id.length <= MAX_NODE_ID_LENGTH &&
		PLAN_ID_PATTERN.test(id)
	);
}

function isValidPlanNodeId(id: unknown): id is string {
	return (
		typeof id === 'string' &&
		id.length > 0 &&
		id.length <= MAX_NODE_ID_LENGTH &&
		NODE_ID_PATTERN.test(id)
	);
}

/**
 * Turn a human title into a path-safe, stable plan id. Ids end up in file
 * names, so anything outside `[a-z0-9._-]` is folded into a single dash.
 */
export function slugifyPlanId(value: string): string {
	const slug = value
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^[^a-z0-9]+/, '')
		.replace(/[^a-z0-9]+$/, '')
		.slice(0, 48);
	return slug.length > 0 ? slug : 'plan';
}

/** A node id derived from the title, unique within `existingIds`. */
export function uniqueNodeId(
	title: string,
	existingIds: Iterable<string>,
): string {
	const taken = new Set(existingIds);
	const base = slugifyPlanId(title).slice(0, 40) || 'node';
	if (!taken.has(base)) return base;

	for (let suffix = 2; suffix < 10_000; suffix++) {
		const candidate = `${base}-${suffix}`;
		if (!taken.has(candidate)) return candidate;
	}
	throw new Error('Could not allocate a unique plan node id');
}

/**
 * Collapse whitespace so a multi-line title cannot break the one-line
 * dashboard rows or the JSONL header.
 */
export function normalizePlanTitle(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/** Build persisted nodes from AI-supplied input, assigning ids and timestamps. */
export function buildPlanNodes(
	inputs: PlanNodeInput[],
	now = new Date().toISOString(),
): PlanNode[] {
	const ids = new Set<string>();

	return inputs.map(input => {
		const title = normalizePlanTitle(input.title);
		const id = input.id?.trim() || uniqueNodeId(title, ids);
		ids.add(id);

		const node: PlanNode = {
			id,
			title,
			status: input.status ?? 'todo',
			dependsOn: uniqueStrings(input.dependsOn ?? []),
			createdAt: now,
			updatedAt: now,
		};

		if (input.description?.trim()) {
			node.description = input.description.trim();
		}
		if (input.agent?.trim()) {
			node.agent = input.agent.trim();
		}
		if (input.checkpoint?.trim()) {
			node.checkpoint = input.checkpoint.trim();
		}
		if (input.blockedReason?.trim()) {
			node.blockedReason = input.blockedReason.trim();
		}
		return node;
	});
}

function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (trimmed && !seen.has(trimmed)) {
			seen.add(trimmed);
			result.push(trimmed);
		}
	}
	return result;
}

/**
 * Validate a complete graph.
 *
 * Dependency gating is deliberate: a node may only be `doing` or `done` once
 * every dependency is `done`, which is what makes the dashboard's "ready now"
 * list trustworthy after a restart. `blocked` always carries a reason so the
 * next session knows what it is waiting on.
 */
export function validatePlanGraph(graph: PlanGraph): PlanValidationResult {
	if (!isValidPlanId(graph.id)) {
		return {
			valid: false,
			error: `Invalid plan id "${graph.id}". Use lowercase letters, numbers, dots, dashes, or underscores.`,
		};
	}

	const title = graph.title?.trim() ?? '';
	if (title.length === 0) {
		return {valid: false, error: 'Plan title cannot be empty'};
	}
	if (title.length > MAX_PLAN_TITLE_LENGTH) {
		return {
			valid: false,
			error: `Plan title must be at most ${MAX_PLAN_TITLE_LENGTH} characters`,
		};
	}

	if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
		return {valid: false, error: 'A plan graph needs at least one node'};
	}
	if (graph.nodes.length > MAX_PLAN_NODES) {
		return {
			valid: false,
			error: `A plan graph supports at most ${MAX_PLAN_NODES} nodes`,
		};
	}

	const byId = new Map<string, PlanNode>();
	for (const node of graph.nodes) {
		if (!isValidPlanNodeId(node.id)) {
			return {
				valid: false,
				error: `Invalid node id "${node.id}". Use letters, numbers, dots, dashes, or underscores.`,
			};
		}
		if (byId.has(node.id)) {
			return {valid: false, error: `Duplicate plan node id "${node.id}"`};
		}
		byId.set(node.id, node);

		const nodeTitle = node.title?.trim() ?? '';
		if (nodeTitle.length === 0) {
			return {
				valid: false,
				error: `Plan node "${node.id}" needs a title`,
			};
		}
		if (nodeTitle.length > MAX_NODE_TITLE_LENGTH) {
			return {
				valid: false,
				error: `Plan node "${node.id}" title must be at most ${MAX_NODE_TITLE_LENGTH} characters`,
			};
		}
		if (
			node.description &&
			node.description.length > MAX_NODE_DESCRIPTION_LENGTH
		) {
			return {
				valid: false,
				error: `Plan node "${node.id}" description is too long`,
			};
		}
		if (!isPlanNodeStatus(node.status)) {
			return {
				valid: false,
				error: `Plan node "${node.id}" has an invalid status`,
			};
		}
		if (!Array.isArray(node.dependsOn)) {
			return {
				valid: false,
				error: `Plan node "${node.id}" dependencies must be an array`,
			};
		}
		if (node.dependsOn.length !== new Set(node.dependsOn).size) {
			return {
				valid: false,
				error: `Plan node "${node.id}" lists the same dependency twice`,
			};
		}
		if (node.dependsOn.includes(node.id)) {
			return {
				valid: false,
				error: `Plan node "${node.id}" cannot depend on itself`,
			};
		}
		if (node.status === 'blocked' && !node.blockedReason?.trim()) {
			return {
				valid: false,
				error: `Plan node "${node.id}" is blocked and needs a reason`,
			};
		}
		if (node.status !== 'blocked' && node.blockedReason?.trim()) {
			return {
				valid: false,
				error: `Plan node "${node.id}" has a blocked reason but status "${node.status}"`,
			};
		}
	}

	for (const node of graph.nodes) {
		for (const dependencyId of node.dependsOn) {
			const dependency = byId.get(dependencyId);
			if (!dependency) {
				return {
					valid: false,
					error: `Plan node "${node.id}" depends on unknown node "${dependencyId}"`,
				};
			}
			if (dependency.id === node.id) {
				return {
					valid: false,
					error: `Plan node "${node.id}" cannot depend on itself`,
				};
			}
		}
	}

	const cycle = findDependencyCycle(graph.nodes, byId);
	if (cycle) {
		return {
			valid: false,
			error: `Plan dependencies form a cycle: ${cycle.join(' -> ')}`,
		};
	}

	for (const node of graph.nodes) {
		if (node.status !== 'doing' && node.status !== 'done') continue;
		const unfinished = node.dependsOn.filter(
			dependencyId => byId.get(dependencyId)?.status !== 'done',
		);
		if (unfinished.length > 0) {
			return {
				valid: false,
				error: `Plan node "${node.id}" is ${node.status} but its dependencies are not done: ${unfinished.join(', ')}`,
			};
		}
	}

	return {valid: true};
}

export function assertValidPlanGraph(graph: PlanGraph): void {
	const result = validatePlanGraph(graph);
	if (!result.valid) {
		throw new Error(result.error);
	}
}

function findDependencyCycle(
	nodes: PlanNode[],
	byId: Map<string, PlanNode>,
): string[] | null {
	const state = new Map<string, 'visiting' | 'visited'>();
	const stack: string[] = [];

	const visit = (id: string): string[] | null => {
		const current = state.get(id);
		if (current === 'visiting') {
			const start = stack.indexOf(id);
			return [...stack.slice(start), id];
		}
		if (current === 'visited') return null;
		state.set(id, 'visiting');
		stack.push(id);

		const node = byId.get(id);
		for (const dependencyId of node?.dependsOn ?? []) {
			if (!byId.has(dependencyId)) continue;
			const cycle = visit(dependencyId);
			if (cycle) return cycle;
		}

		stack.pop();
		state.set(id, 'visited');
		return null;
	};

	for (const node of nodes) {
		const cycle = visit(node.id);
		if (cycle) return cycle;
	}
	return null;
}

export function computePlanStats(nodes: PlanNode[]): PlanStats {
	const stats: PlanStats = {
		total: nodes.length,
		todo: 0,
		doing: 0,
		done: 0,
		blocked: 0,
	};
	for (const node of nodes) {
		stats[node.status] += 1;
	}
	return stats;
}

export function summarizePlan(plan: PlanGraph): PlanSummary {
	const stats = computePlanStats(plan.nodes);
	return {
		id: plan.id,
		title: plan.title,
		total: stats.total,
		done: stats.done,
		doing: stats.doing,
		blocked: stats.blocked,
		updatedAt: plan.updatedAt,
	};
}

/**
 * Todo nodes whose dependencies are all done — the set the model should pick
 * from when it resumes. Ordered as the nodes appear in the plan.
 */
export function getReadyNodes(nodes: PlanNode[]): PlanNode[] {
	const done = new Set(
		nodes.filter(node => node.status === 'done').map(node => node.id),
	);
	return nodes.filter(
		node => node.status === 'todo' && node.dependsOn.every(id => done.has(id)),
	);
}

/** Todo nodes still waiting on at least one unfinished dependency. */
export function getWaitingNodes(nodes: PlanNode[]): PlanNode[] {
	const done = new Set(
		nodes.filter(node => node.status === 'done').map(node => node.id),
	);
	return nodes.filter(
		node => node.status === 'todo' && node.dependsOn.some(id => !done.has(id)),
	);
}

/**
 * Stable topological order for display. Falls back to the original order if a
 * cycle slipped past validation (e.g. a hand-edited file), so rendering never
 * throws.
 */
export function orderPlanNodes(nodes: PlanNode[]): PlanNode[] {
	const byId = new Map(nodes.map(node => [node.id, node]));
	const indegree = new Map<string, number>();
	const dependents = new Map<string, string[]>();

	for (const node of nodes) {
		const known = node.dependsOn.filter(id => byId.has(id));
		indegree.set(node.id, known.length);
		for (const dependencyId of known) {
			const list = dependents.get(dependencyId) ?? [];
			list.push(node.id);
			dependents.set(dependencyId, list);
		}
	}

	const queue = nodes
		.filter(node => (indegree.get(node.id) ?? 0) === 0)
		.map(node => node.id);
	const ordered: PlanNode[] = [];

	while (queue.length > 0) {
		const id = queue.shift();
		if (!id) break;
		const node = byId.get(id);
		if (node) ordered.push(node);
		for (const dependentId of dependents.get(id) ?? []) {
			const next = (indegree.get(dependentId) ?? 1) - 1;
			indegree.set(dependentId, next);
			if (next === 0) queue.push(dependentId);
		}
	}

	return ordered.length === nodes.length ? ordered : [...nodes];
}
