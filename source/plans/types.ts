/**
 * Persistent plan graphs (issue #1491).
 *
 * A plan used to be a flat markdown file that only existed in the session that
 * produced it. The graph below is the durable form: nodes with an explicit
 * status, their dependencies, and the agent/checkpoint each one is tied to. It
 * lives in `.nanocoder/plans/` so `/resume` in a new process can pick the plan
 * back up instead of relying on the model's context window.
 */

export type PlanNodeStatus = 'todo' | 'doing' | 'done' | 'blocked';

const PLAN_NODE_STATUSES: readonly PlanNodeStatus[] = [
	'todo',
	'doing',
	'done',
	'blocked',
];

export function isPlanNodeStatus(value: unknown): value is PlanNodeStatus {
	return (
		typeof value === 'string' &&
		(PLAN_NODE_STATUSES as readonly string[]).includes(value)
	);
}

/** A node as the AI supplies it, before ids and timestamps are assigned. */
export interface PlanNodeInput {
	id?: string;
	title: string;
	description?: string;
	status?: PlanNodeStatus;
	dependsOn?: string[];
	agent?: string;
	checkpoint?: string;
	blockedReason?: string;
}

/** A node as it is persisted. */
export interface PlanNode {
	id: string;
	title: string;
	description?: string;
	status: PlanNodeStatus;
	dependsOn: string[];
	/** Subagent type this node should be delegated to, when one is chosen. */
	agent?: string;
	/** Checkpoint name or action-timeline checkpoint id linked to this node. */
	checkpoint?: string;
	/** Why the node is blocked. Required whenever status is `blocked`. */
	blockedReason?: string;
	createdAt: string;
	updatedAt: string;
}

export interface PlanGraph {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	nodes: PlanNode[];
}

export interface PlanSummary {
	id: string;
	title: string;
	total: number;
	done: number;
	doing: number;
	blocked: number;
	updatedAt: string;
}

export interface PlanIndex {
	version: 1;
	activePlanId: string | null;
	plans: PlanSummary[];
}

export interface PlanStats {
	total: number;
	todo: number;
	doing: number;
	done: number;
	blocked: number;
}

export type PlanValidationResult =
	| {valid: true}
	| {valid: false; error: string};
