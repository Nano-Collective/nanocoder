import {
	computePlanStats,
	getReadyNodes,
	getWaitingNodes,
	orderPlanNodes,
} from './graph.js';
import {PlanStore} from './storage.js';
import type {PlanGraph, PlanNodeStatus} from './types.js';

const STATUS_ICON: Record<PlanNodeStatus, string> = {
	todo: '○',
	doing: '◐',
	done: '✓',
	blocked: '!',
};

const DEFAULT_MAX_CONTEXT_NODES = 60;

export interface PlanContextOptions {
	/** Cap the node list so a huge plan cannot crowd out the conversation. */
	maxNodes?: number;
}

/**
 * Compact, model-facing view of the active plan.
 *
 * This is appended to the system prompt on every turn rather than baked into
 * the cached base prompt: resuming a session in a new process must see the
 * state that was written by an earlier one, and the graph changes while the
 * base prompt is cached.
 */
export function renderPlanContextBlock(
	plan: PlanGraph,
	options: PlanContextOptions = {},
): string {
	const maxNodes = options.maxNodes ?? DEFAULT_MAX_CONTEXT_NODES;
	const stats = computePlanStats(plan.nodes);
	const ordered = orderPlanNodes(plan.nodes);
	const visible = ordered.slice(0, maxNodes);
	const ready = getReadyNodes(plan.nodes);
	const waiting = getWaitingNodes(plan.nodes);
	const blocked = plan.nodes.filter(node => node.status === 'blocked');

	const lines: string[] = [
		'## ACTIVE PLAN (persisted)',
		'',
		`**${plan.title}** — ${stats.done}/${stats.total} done` +
			(stats.doing > 0 ? `, ${stats.doing} doing` : '') +
			(stats.blocked > 0 ? `, ${stats.blocked} blocked` : '') +
			`. Plan id: \`${plan.id}\`.`,
	];

	if (ready.length > 0) {
		lines.push(`- Ready now: ${ready.map(node => node.id).join(', ')}`);
	} else if (stats.done === stats.total) {
		lines.push('- All nodes are done.');
	} else {
		lines.push('- Ready now: none — remaining nodes are waiting or blocked');
	}
	if (waiting.length > 0) {
		lines.push(
			`- Waiting on dependencies: ${waiting.map(node => node.id).join(', ')}`,
		);
	}
	if (blocked.length > 0) {
		lines.push(
			`- Blocked: ${blocked
				.map(
					node =>
						`${node.id}${node.blockedReason ? ` (${node.blockedReason})` : ''}`,
				)
				.join(', ')}`,
		);
	}

	lines.push('', 'Node status (dependency order):');
	for (const node of visible) {
		const details: string[] = [];
		if (node.dependsOn.length > 0) {
			details.push(`after ${node.dependsOn.join(', ')}`);
		}
		if (node.agent) details.push(`agent: ${node.agent}`);
		if (node.checkpoint) details.push(`checkpoint: ${node.checkpoint}`);
		if (node.status === 'blocked' && node.blockedReason) {
			details.push(`blocked: ${node.blockedReason}`);
		}
		const suffix = details.length > 0 ? ` (${details.join('; ')})` : '';
		lines.push(
			`- ${STATUS_ICON[node.status]} ${node.id} — ${node.title}${suffix}`,
		);
	}

	if (ordered.length > visible.length) {
		lines.push(
			`- … ${ordered.length - visible.length} more node(s); call get_plan for the full graph.`,
		);
	}

	lines.push(
		'',
		'Keep this graph current with update_plan_node as you work: move a node to `doing` when you start it, `done` when it is finished, and `blocked` (with a reason) when it cannot proceed. Do not claim a node is done before its dependencies are done.',
	);

	return lines.join('\n');
}

/**
 * Append the active plan to a system prompt. Any storage failure degrades to
 * the unchanged prompt — a corrupt plan file must never block a chat turn.
 */
export async function appendActivePlanContext(
	systemPrompt: string,
	store: PlanStore = new PlanStore(),
	options: PlanContextOptions = {},
): Promise<string> {
	try {
		const plan = await store.getActivePlan();
		if (!plan) return systemPrompt;
		return `${systemPrompt}\n\n${renderPlanContextBlock(plan, options)}`;
	} catch {
		return systemPrompt;
	}
}
