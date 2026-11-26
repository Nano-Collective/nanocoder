import path from 'node:path';
import {z} from 'zod';
import {isPathInScope, normalizeScopeEntry} from '@/utils/restricted-scope';

function isUsableScopeEntry(entry: string): boolean {
	const normalized = normalizeScopeEntry(entry);
	return (
		entry.trim() !== '' &&
		!path.posix.isAbsolute(normalized) &&
		!path.win32.isAbsolute(normalized) &&
		normalized !== '..' &&
		!normalized.startsWith('../') &&
		// Scopes are matched literally and passed to workers comma separated.
		!/[*?,]/.test(normalized)
	);
}

const ScopeEntrySchema = z
	.string()
	.refine(isUsableScopeEntry, {
		message:
			'must be a relative file or directory path inside the repository, without globs or commas',
	})
	.transform(normalizeScopeEntry);

export const TaskSchema = z.object({
	tasks: z
		.array(
			z.object({
				id: z
					.string()
					.max(40)
					.regex(
						/^[a-z0-9-]+$/,
						'Worker ID must be alphanumeric and dashes only',
					),
				description: z.string().trim().min(1),
				fileScope: z.array(ScopeEntrySchema).min(1),
			}),
		)
		.min(1),
});

export type TaskDefinition = z.infer<typeof TaskSchema>['tasks'][number];

/**
 * Returns an error message if two tasks share an id or could edit the same
 * file. Case is ignored because the filesystem may ignore it too.
 */
export function validateDisjointScopes(tasks: TaskDefinition[]): string | null {
	const ids = new Set<string>();
	for (const task of tasks) {
		if (ids.has(task.id)) return `Duplicate task id "${task.id}".`;
		ids.add(task.id);
	}

	const fold = (entry: string) => normalizeScopeEntry(entry).toLowerCase();
	for (const [index, first] of tasks.entries()) {
		for (const second of tasks.slice(index + 1)) {
			for (const a of first.fileScope.map(fold)) {
				for (const b of second.fileScope.map(fold)) {
					if (isPathInScope(a, [b]) || isPathInScope(b, [a])) {
						return `Overlap detected between ${first.id} ("${a || '.'}") and ${second.id} ("${b || '.'}").`;
					}
				}
			}
		}
	}
	return null;
}
