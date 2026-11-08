import {formatPlanToolResult} from '@/plans/format';
import {PlanStore} from '@/plans/storage';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';

interface GetPlanArgs {
	plan_id?: string;
}

export function createGetPlanTool(
	store: PlanStore = new PlanStore(),
): NanocoderToolExport {
	return {
		name: 'get_plan',
		tool: tool({
			description:
				'Read the persisted plan graph: node statuses, dependencies, assigned agents, ' +
				'checkpoint links, blocked reasons, and which nodes are ready now. ' +
				'Defaults to the active plan; pass plan_id to inspect another one.',
			inputSchema: jsonSchema<GetPlanArgs>({
				type: 'object',
				properties: {
					plan_id: {
						type: 'string',
						description: 'Plan id to read. Defaults to the active plan.',
					},
				},
			}),
			execute: async (args: GetPlanArgs) => {
				const planId = args.plan_id?.trim();
				const plan = planId
					? await store.loadPlan(planId)
					: await store.getActivePlan();

				if (!plan) {
					return planId
						? `Plan "${planId}" was not found in .nanocoder/plans.`
						: 'No plan graph yet. Create one with write_plan (pass `nodes`) or run /plans list.';
				}

				return formatPlanToolResult(plan);
			},
		}),
		validator: async args => {
			if (args.plan_id !== undefined && typeof args.plan_id !== 'string') {
				return {valid: false, error: 'plan_id must be a string'};
			}
			return {valid: true};
		},
		approval: false,
		readOnly: true,
	};
}

export const getPlanTool = createGetPlanTool();
