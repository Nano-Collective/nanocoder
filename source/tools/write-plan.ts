import type {ArtifactManager} from '@/artifacts/artifact-manager';
import {artifactManager} from '@/artifacts/artifact-manager';
import type {NanocoderToolExport, ToolExecutionContext} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';

interface WritePlanArgs {
	content: string;
}

export function createWritePlanTool(
	manager: ArtifactManager,
): NanocoderToolExport {
	return {
		name: 'write_plan',
		tool: tool({
			description:
				'Persist the complete implementation plan for the current session. ' +
				'Each call replaces the previous plan. Call this before finishing a planning turn.',
			inputSchema: jsonSchema<WritePlanArgs>({
				type: 'object',
				properties: {
					content: {
						type: 'string',
						description: 'The complete implementation plan in Markdown',
					},
				},
				required: ['content'],
			}),
			execute: async (args, options) => {
				const sessionId = (options as ToolExecutionContext | undefined)
					?.sessionId;
				if (!sessionId) {
					throw new Error('write_plan requires an active session');
				}
				const artifactPath = await manager.writeArtifact(
					sessionId,
					'implementation_plan',
					args.content,
				);
				return `Plan saved to ${artifactPath}`;
			},
		}),
		validator: async args => {
			if (
				typeof args.content !== 'string' ||
				args.content.trim().length === 0
			) {
				return {valid: false, error: 'Plan content cannot be empty'};
			}
			return {valid: true};
		},
		approval: false,
	};
}

export const writePlanTool = createWritePlanTool(artifactManager);
