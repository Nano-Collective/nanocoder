import {randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
	type ArtifactManager,
	artifactManager,
} from '@/artifacts/artifact-manager';
import {getCliSessionId} from '@/session/cli-session-context';
import type {Task} from './types';

const TASKS_DIR = '.nanocoder';
const TASKS_FILE = 'tasks.json';

export function getTasksPath(
	sessionId?: string,
	artifacts: ArtifactManager = artifactManager,
): string {
	const resolvedSessionId = sessionId ?? getCliSessionId();
	if (resolvedSessionId) {
		return artifacts.getArtifactPath(resolvedSessionId, 'tasks');
	}
	return join(process.cwd(), TASKS_DIR, TASKS_FILE);
}

export async function loadTasks(
	sessionId?: string,
	artifacts: ArtifactManager = artifactManager,
): Promise<Task[]> {
	const resolvedSessionId = sessionId ?? getCliSessionId();
	try {
		const content = resolvedSessionId
			? await artifacts.readArtifact(resolvedSessionId, 'tasks')
			: await readFile(getTasksPath(), 'utf-8');
		if (!content) return [];
		return JSON.parse(content) as Task[];
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
	if (resolvedSessionId) {
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
		return;
	}

	const dirPath = join(process.cwd(), TASKS_DIR);
	await mkdir(dirPath, {recursive: true});
	const path = getTasksPath();
	await writeFile(path, JSON.stringify(tasks, null, 2), 'utf-8');
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
