import {randomUUID} from 'node:crypto';
import {
	type ArtifactManager,
	artifactManager,
} from '@/artifacts/artifact-manager';
import {getCliSessionId} from '@/session/cli-session-context';
import type {Task} from './types';

/**
 * Task state is session-scoped and lives with the session's artifacts, never
 * in the working directory. The legacy `.nanocoder/tasks.json` in cwd is gone:
 * it leaked agent bookkeeping into the user's repo, was shared by every
 * concurrent session, and could not be resumed alongside the conversation it
 * belonged to.
 *
 * Every caller has a session id — the interactive CLI allocates one before it
 * dispatches a message or a slash command, ACP and `--plain` pass theirs
 * explicitly, and subagents are not allowed to touch tasks at all. When no
 * session id can be resolved there is nowhere legitimate to persist to, so
 * reads return empty and writes are a no-op rather than falling back to disk.
 */

/**
 * Absolute path of the session's task JSON, or null when no session is
 * resolvable.
 */
export function getTasksPath(
	sessionId?: string,
	artifacts: ArtifactManager = artifactManager,
): string | null {
	const resolvedSessionId = sessionId ?? getCliSessionId();
	if (!resolvedSessionId) return null;
	return artifacts.getArtifactPath(resolvedSessionId, 'tasks');
}

export async function loadTasks(
	sessionId?: string,
	artifacts: ArtifactManager = artifactManager,
): Promise<Task[]> {
	const resolvedSessionId = sessionId ?? getCliSessionId();
	if (!resolvedSessionId) return [];
	try {
		const content = await artifacts.readArtifact(resolvedSessionId, 'tasks');
		if (!content) return [];
		const parsed = JSON.parse(content);
		return Array.isArray(parsed) ? (parsed as Task[]) : [];
	} catch {
		return [];
	}
}

export async function saveTasks(
	tasks: Task[],
	sessionId?: string,
	artifacts: ArtifactManager = artifactManager,
): Promise<void> {
	const resolvedSessionId = sessionId ?? getCliSessionId();
	if (!resolvedSessionId) return;

	await artifacts.writeArtifact(
		resolvedSessionId,
		'tasks',
		JSON.stringify(tasks, null, 2),
	);
	await artifacts.writeArtifact(
		resolvedSessionId,
		'task',
		tasksToMarkdown(tasks),
	);
}

function tasksToMarkdown(tasks: Task[]): string {
	const lines = ['# Tasks', ''];
	for (const task of tasks) {
		const checkbox = task.status === 'completed' ? '[x]' : '[ ]';
		const prefix = task.status === 'in_progress' ? '**In progress:** ' : '';
		lines.push(`- ${checkbox} ${prefix}${task.title}`);
		if (task.description) lines.push(`  - ${task.description}`);
	}
	return `${lines.join('\n')}\n`;
}

export function generateTaskId(): string {
	return randomUUID().slice(0, 8);
}

export async function clearAllTasks(
	sessionId?: string,
	artifacts: ArtifactManager = artifactManager,
): Promise<void> {
	await saveTasks([], sessionId, artifacts);
}
