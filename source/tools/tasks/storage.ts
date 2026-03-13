import {randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Task} from './types';

const TASKS_DIR = '.nanocoder';
const TASKS_FILE = 'tasks.json';

export function getTasksPath(): string {
	return join(process.cwd(), TASKS_DIR, TASKS_FILE);
}

export async function loadTasks(): Promise<Task[]> {
	try {
		const path = getTasksPath();
		const content = await readFile(path, 'utf-8');
		return JSON.parse(content) as Task[];
	} catch {
		return [];
	}
}

export async function saveTasks(tasks: Task[]): Promise<void> {
	const dirPath = join(process.cwd(), TASKS_DIR);
	await mkdir(dirPath, {recursive: true});
	const path = getTasksPath();
	await writeFile(path, JSON.stringify(tasks, null, 2), 'utf-8');
}

export function generateTaskId(): string {
	return randomUUID().slice(0, 8);
}

export async function clearAllTasks(): Promise<void> {
	await saveTasks([]);
}
