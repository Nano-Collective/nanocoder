import {formatPlanNodeUpdate, formatPlanToolResult} from '@/plans/format';
import type {PlanNodePatch} from '@/plans/storage';
import {PlanStore} from '@/plans/storage';
import type {PlanNodeStatus} from '@/plans/types';
import {isPlanNodeStatus} from '@/plans/types';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';

interface UpdatePlanNodeArgs {
	plan_id?: string;
	node_id: string;
	status?: PlanNodeStatus;
	title?: string;
	description?: string;
	agent?: string;
	checkpoint?: string;
	blocked_reason?: string;
	depends_on?: string[];
}

function hasMutation(args: UpdatePlanNodeArgs): boolean {
	return (
		args.status !== undefined ||
		args.title !== undefined ||
		args.description !== undefined ||
		args.agent !== undefined ||
		args.checkpoint !== undefined ||
		args.blocked_reason !== undefined ||
		args.depends_on !== undefined
	);
}

export function createUpdatePlanNodeTool(
	store: PlanStore = new PlanStore(),
): NanocoderToolExport {
	return {
		name: 'update_plan_node',
		tool: tool({
			description:
				'Update one node in the persisted plan graph. Use this as you work: mark a node ' +
				'`doing` when you start it, `done` when it is finished, and `blocked` with a reason ' +
				'when it cannot proceed. A dependent node can only move to doing/done once every ' +
				'dependency is done. Optionally attach the subagent type handling the node and a ' +
				'timeline checkpoint name.',
			inputSchema: jsonSchema<UpdatePlanNodeArgs>({
				type: 'object',
				properties: {
					plan_id: {
						type: 'string',
						description: 'Plan id. Defaults to the active plan.',
					},
					node_id: {
						type: 'string',
						description: 'Id of the node to update',
					},
					status: {
						type: 'string',
						enum: ['todo', 'doing', 'done', 'blocked'],
						description: 'New node status',
					},
					title: {type: 'string', description: 'Replacement title'},
					description: {
						type: 'string',
						description: 'Replacement detail text (empty string clears it)',
					},
					agent: {
						type: 'string',
						description:
							'Subagent type assigned to this node (empty string clears it)',
					},
					checkpoint: {
						type: 'string',
						description:
							'Checkpoint name or action-timeline id linked to this node (empty string clears it)',
					},
					blocked_reason: {
						type: 'string',
						description:
							'Why the node is blocked. Required when status is blocked; empty string clears it.',
					},
					depends_on: {
						type: 'array',
						items: {type: 'string'},
						description: 'Replacement dependency ids',
					},
				},
				required: ['node_id'],
			}),
			execute: async (args: UpdatePlanNodeArgs) => {
				const planId = args.plan_id?.trim() || (await store.getActivePlanId());
				if (!planId) {
					throw new Error(
						'No active plan graph. Create one with write_plan (pass `nodes`) or select one with /plans use <id>.',
					);
				}

				const patch: PlanNodePatch = {};
				if (args.status !== undefined) patch.status = args.status;
				if (args.title !== undefined) patch.title = args.title;
				if (args.description !== undefined) {
					patch.description = args.description;
				}
				if (args.agent !== undefined) patch.agent = args.agent;
				if (args.checkpoint !== undefined) patch.checkpoint = args.checkpoint;
				if (args.blocked_reason !== undefined) {
					patch.blockedReason = args.blocked_reason;
				}
				if (args.depends_on !== undefined) {
					patch.dependsOn = args.depends_on;
				}

				const {plan, node} = await store.updatePlanNode(
					planId,
					args.node_id.trim(),
					patch,
				);

				return `${formatPlanNodeUpdate(node)}\n\n${formatPlanToolResult(plan)}`;
			},
		}),
		validator: async args => {
			if (
				!args ||
				typeof args.node_id !== 'string' ||
				args.node_id.trim().length === 0
			) {
				return {valid: false, error: 'node_id is required'};
			}
			if (args.status !== undefined && !isPlanNodeStatus(args.status)) {
				return {
					valid: false,
					error: 'status must be one of todo, doing, done, blocked',
				};
			}
			if (
				args.depends_on !== undefined &&
				(!Array.isArray(args.depends_on) ||
					args.depends_on.some(
						(dependency: unknown) => typeof dependency !== 'string',
					))
			) {
				return {valid: false, error: 'depends_on must be an array of ids'};
			}
			if (!hasMutation(args)) {
				return {
					valid: false,
					error: 'Provide at least one field to update',
				};
			}
			return {valid: true};
		},
		approval: false,
	};
}

export const updatePlanNodeTool = createUpdatePlanNodeTool();
