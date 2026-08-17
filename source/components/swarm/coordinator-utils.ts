import path from 'node:path';
import {z} from 'zod';

export const TaskSchema = z.object({
	tasks: z.array(
		z.object({
			id: z
				.string()
				.describe('A unique identifier for the worker (e.g. worker-1)'),
			description: z.string().describe('The prompt for this worker'),
			fileScope: z
				.array(z.string())
				.describe(
					'The specific file paths or directories this worker is allowed to modify (e.g. ["src/auth", "package.json"]). Scopes between workers MUST be mutually exclusive.',
				),
		}),
	),
});

export type TaskDefinition = z.infer<typeof TaskSchema>['tasks'][0];

/**
 * Validates that no two tasks have overlapping file scopes.
 * A scope overlaps if one path is a parent/child of another, or they are exactly the same.
 */
export function validateDisjointScopes(tasks: TaskDefinition[]): string | null {
	for (let i = 0; i < tasks.length; i++) {
		for (let j = i + 1; j < tasks.length; j++) {
			const scopeA = tasks[i]?.fileScope || [];
			const scopeB = tasks[j]?.fileScope || [];

			for (const pathA of scopeA) {
				for (const pathB of scopeB) {
					// Normalize paths to prevent false mismatches
					const normA = path.normalize(pathA);
					const normB = path.normalize(pathB);

					if (
						normA === normB ||
						normA.startsWith(normB + path.sep) ||
						normB.startsWith(normA + path.sep)
					) {
						return `Overlap detected between worker ${tasks[i]?.id} ("${pathA}") and worker ${tasks[j]?.id} ("${pathB}")`;
					}
				}
			}
		}
	}
	return null;
}
