import type {ArtifactManager} from '@/artifacts/artifact-manager';
import {artifactManager} from '@/artifacts/artifact-manager';
import {computePlanStats} from '@/plans/graph';
import {PlanStore} from '@/plans/storage';
import type {PlanGraph, PlanNodeInput, PlanNodeStatus} from '@/plans/types';
import type {NanocoderToolExport, ToolExecutionContext} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';

interface WritePlanNodeArgs {
	id?: string;
	title: string;
	description?: string;
	status?: PlanNodeStatus;
	depends_on?: string[];
	agent?: string;
	checkpoint?: string;
	blocked_reason?: string;
}

interface WritePlanArgs {
	content?: string;
	title?: string;
	plan_id?: string;
	nodes?: WritePlanNodeArgs[];
}

function toNodeInputs(args: WritePlanNodeArgs[]): PlanNodeInput[] {
	return args.map(node => ({
		id: node.id,
		title: node.title,
		description: node.description,
		status: node.status,
		dependsOn: node.depends_on,
		agent: node.agent,
		checkpoint: node.checkpoint,
		blockedReason: node.blocked_reason,
	}));
}

/** First markdown heading, used when the caller supplies no explicit title. */
function deriveTitle(content: string | undefined): string | undefined {
	const heading = content
		?.split(/\r?\n/)
		.map(line => line.trim())
		.find(line => /^#{1,6}\s+\S/.test(line));
	if (!heading) return undefined;
	return heading.replace(/^#{1,6}\s+/, '').trim() || undefined;
}

async function persistGraph(
	store: PlanStore,
	args: WritePlanArgs,
	content: string | undefined,
): Promise<PlanGraph> {
	if (!args.nodes || args.nodes.length === 0) {
		throw new Error('write_plan needs at least one node to build a plan graph');
	}

	const nodes = toNodeInputs(args.nodes);
	const title =
		args.title?.trim() || deriveTitle(content) || 'Implementation plan';

	if (args.plan_id) {
		return store.replacePlan(args.plan_id, {title, nodes});
	}

	const active = await store.getActivePlan();
	if (active) {
		return store.replacePlan(active.id, {title, nodes});
	}

	return store.createPlan({title, nodes});
}

export function createWritePlanTool(
	manager: ArtifactManager,
	store: PlanStore = new PlanStore(),
): NanocoderToolExport {
	return {
		name: 'write_plan',
		tool: tool({
			description:
				'Persist the complete implementation plan for the current session. ' +
				'Each call replaces the previous plan. Call this before finishing a planning turn. ' +
				'Pass `nodes` to also persist a durable task graph: every node has an id, a title, ' +
				'an optional status (todo/doing/done/blocked), and `depends_on` ids. The graph is ' +
				'written to .nanocoder/plans so it survives session restarts. When a plan graph ' +
				'already exists, `nodes` replaces it; use update_plan_node for targeted status changes.',
			inputSchema: jsonSchema<WritePlanArgs>({
				type: 'object',
				properties: {
					content: {
						type: 'string',
						description:
							'The complete implementation plan in Markdown. Required unless `nodes` is provided.',
					},
					title: {
						type: 'string',
						description:
							'Short plan title. Defaults to the first markdown heading, or the active plan title.',
					},
					plan_id: {
						type: 'string',
						description:
							'Replace this existing plan graph instead of the active one.',
					},
					nodes: {
						type: 'array',
						description:
							'Complete task graph. Replaces the nodes of the target plan. Statuses default to todo.',
						items: {
							type: 'object',
							properties: {
								id: {
									type: 'string',
									description:
										'Stable node id (letters, numbers, dots, dashes, underscores). Generated from the title when omitted.',
								},
								title: {
									type: 'string',
									description: 'Short, action-oriented task title',
								},
								description: {
									type: 'string',
									description: 'Optional longer detail for the node',
								},
								status: {
									type: 'string',
									enum: ['todo', 'doing', 'done', 'blocked'],
									description: 'Node status (defaults to todo)',
								},
								depends_on: {
									type: 'array',
									items: {type: 'string'},
									description: 'Ids of nodes that must be done first',
								},
								agent: {
									type: 'string',
									description:
										'Optional subagent type to delegate this node to (e.g. explore, general)',
								},
								checkpoint: {
									type: 'string',
									description:
										'Optional checkpoint name or action-timeline id linked to this node',
								},
								blocked_reason: {
									type: 'string',
									description:
										'Required when status is blocked: what the node is waiting on',
								},
							},
							required: ['title'],
						},
					},
				},
			}),
			execute: async (args, options) => {
				const sessionId = (options as ToolExecutionContext | undefined)
					?.sessionId;

				const content =
					typeof args.content === 'string' && args.content.trim().length > 0
						? args.content
						: undefined;

				const results: string[] = [];
				if (content) {
					if (!sessionId) {
						throw new Error('write_plan requires an active session');
					}
					const artifactPath = await manager.writeArtifact(
						sessionId,
						'implementation_plan',
						content,
					);
					results.push(`Plan saved to ${artifactPath}`);
				}

				if (args.nodes !== undefined) {
					const graph = await persistGraph(store, args, content);
					const stats = computePlanStats(graph.nodes);
					results.push(
						`Plan graph "${graph.id}" saved (${stats.done}/${stats.total} done) at ${store.getPlanPath(graph.id)}`,
					);
				}

				return results.join('\n');
			},
		}),
		validator: async args => {
			const content =
				typeof args.content === 'string' ? args.content.trim() : '';
			const nodes = Array.isArray(args.nodes) ? args.nodes : undefined;

			if (nodes && nodes.length === 0) {
				return {valid: false, error: 'Plan graph needs at least one node'};
			}
			if (!content && !nodes) {
				return {valid: false, error: 'Plan content cannot be empty'};
			}
			if (nodes) {
				for (const [index, node] of nodes.entries()) {
					if (
						!node ||
						typeof node.title !== 'string' ||
						node.title.trim().length === 0
					) {
						return {
							valid: false,
							error: `Plan node ${index + 1} needs a title`,
						};
					}
				}
			}
			return {valid: true};
		},
		approval: false,
	};
}

export const writePlanTool = createWritePlanTool(artifactManager);
