import {
	computePlanStats,
	getReadyNodes,
	getWaitingNodes,
	orderPlanNodes,
} from './graph.js';
import type {PlanGraph, PlanNode, PlanNodeStatus} from './types.js';

const STATUS_ICON: Record<PlanNodeStatus, string> = {
	todo: '○',
	doing: '◐',
	done: '✓',
	blocked: '!',
};

const STATUS_LABEL: Record<PlanNodeStatus, string> = {
	todo: 'todo',
	doing: 'doing',
	done: 'done',
	blocked: 'blocked',
};

function progress(plan: PlanGraph): string {
	const stats = computePlanStats(plan.nodes);
	return `${stats.done}/${stats.total} done`;
}

function nodeAnnotation(node: PlanNode): string {
	const parts: string[] = [];
	if (node.agent) parts.push(`agent: ${node.agent}`);
	if (node.checkpoint) parts.push(`checkpoint: ${node.checkpoint}`);
	if (node.status === 'blocked' && node.blockedReason) {
		parts.push(`blocked: ${node.blockedReason}`);
	}
	if (node.status === 'todo' && node.dependsOn.length > 0) {
		parts.push(`after: ${node.dependsOn.join(', ')}`);
	}
	return parts.length > 0 ? `  (${parts.join(' · ')})` : '';
}

/** One line per node, in dependency order. */
function formatPlanNodeLine(node: PlanNode): string {
	return `${STATUS_ICON[node.status]} ${node.id}  ${node.title}${nodeAnnotation(node)}`;
}

/**
 * Dashboard shown by `/plans` and returned from the plan tools. Plain text so
 * it reads the same in the TUI, in a tool result, and in a pasted bug report.
 */
function formatPlanDashboard(plan: PlanGraph): string {
	const stats = computePlanStats(plan.nodes);
	const ready = getReadyNodes(plan.nodes);
	const waiting = getWaitingNodes(plan.nodes);
	const blocked = plan.nodes.filter(node => node.status === 'blocked');

	const lines: string[] = [
		`Plan: ${plan.title} (${progress(plan)})`,
		`id: ${plan.id}`,
		`${stats.todo} todo · ${stats.doing} doing · ${stats.done} done · ${stats.blocked} blocked`,
	];

	if (ready.length > 0) {
		lines.push(`Ready now: ${ready.map(node => node.id).join(', ')}`);
	} else if (stats.done === stats.total) {
		lines.push('All nodes are done.');
	} else {
		lines.push('Ready now: none — every remaining task is waiting or blocked');
	}

	if (blocked.length > 0) {
		const blockedList = blocked
			.map(
				node =>
					`${node.id}${node.blockedReason ? ` (${node.blockedReason})` : ''}`,
			)
			.join(', ');
		lines.push(`Blocked: ${blockedList}`);
	}

	if (waiting.length > 0) {
		lines.push(
			`Waiting on dependencies: ${waiting.map(node => node.id).join(', ')}`,
		);
	}

	lines.push('');
	for (const node of orderPlanNodes(plan.nodes)) {
		lines.push(formatPlanNodeLine(node));
	}

	return lines.join('\n');
}

/** Formatted payload returned by `get_plan` / `update_plan_node`. */
export function formatPlanToolResult(plan: PlanGraph): string {
	const stats = computePlanStats(plan.nodes);
	const ready = getReadyNodes(plan.nodes);
	const next =
		stats.done === stats.total
			? 'Every node is done.'
			: ready.length > 0
				? `Next ready node(s): ${ready.map(node => `${node.id} (${node.title})`).join(', ')}`
				: 'No node is ready right now.';
	const footer = [
		'',
		next,
		'Use update_plan_node (outside plan mode) to move a node to doing/done/blocked, and get_plan to refresh this view.',
	];
	return `${formatPlanDashboard(plan)}\n${footer.join('\n')}`;
}

/** Single-node confirmation for `update_plan_node`. */
export function formatPlanNodeUpdate(node: PlanNode): string {
	const status = STATUS_LABEL[node.status];
	const annotations = nodeAnnotation(node);
	return `${STATUS_ICON[node.status]} ${node.id} is now ${status}${annotations}`;
}
