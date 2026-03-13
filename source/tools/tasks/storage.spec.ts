import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type {Task} from './types.js';

// ============================================================================
// Task Storage Tests
// ============================================================================
// Tests for the task storage functions that handle persisting tasks to disk.
// Uses a temporary directory to avoid polluting the actual project.

// Store original cwd and override process.cwd for isolated testing
let testDir: string;
let originalCwd: typeof process.cwd;

test.before(async () => {
	testDir = join(tmpdir(), `nanocoder-task-storage-test-${Date.now()}`);
	await mkdir(testDir, {recursive: true});
	originalCwd = process.cwd;
});

test.after.always(async () => {
	process.cwd = originalCwd;
	if (testDir) {
		await rm(testDir, {recursive: true, force: true}).catch(() => {});
	}
});

// Helper to create isolated test environment
async function setupTestEnv(
	subDir: string,
): Promise<{dir: string; restore: () => void}> {
	const dir = join(testDir, subDir);
	await mkdir(dir, {recursive: true});
	const savedCwd = process.cwd;
	process.cwd = () => dir;
	return {
		dir,
		restore: () => {
			process.cwd = savedCwd;
		},
	};
}

// ============================================================================
// generateTaskId Tests
// ============================================================================

test('generateTaskId - generates 8-character string', async t => {
	const {generateTaskId} = await import('./storage.js');
	const id = generateTaskId();
	t.is(id.length, 8);
});

test('generateTaskId - generates unique IDs', async t => {
	const {generateTaskId} = await import('./storage.js');
	const ids = new Set<string>();
	for (let i = 0; i < 100; i++) {
		ids.add(generateTaskId());
	}
	t.is(ids.size, 100);
});

test('generateTaskId - generates valid UUID prefix format', async t => {
	const {generateTaskId} = await import('./storage.js');
	const id = generateTaskId();
	// Should match hex characters (UUID format)
	t.regex(id, /^[a-f0-9]{8}$/);
});

// ============================================================================
// getTasksPath Tests
// ============================================================================

test('getTasksPath - returns correct path structure', async t => {
	const env = await setupTestEnv('path-test');
	try {
		const {getTasksPath} = await import('./storage.js');
		const path = getTasksPath();
		t.true(path.endsWith('.nanocoder/tasks.json'));
		t.true(path.includes(env.dir));
	} finally {
		env.restore();
	}
});

// ============================================================================
// loadTasks Tests
// ============================================================================

test('loadTasks - returns empty array when no file exists', async t => {
	const env = await setupTestEnv('load-no-file');
	try {
		const {loadTasks} = await import('./storage.js');
		const tasks = await loadTasks();
		t.deepEqual(tasks, []);
	} finally {
		env.restore();
	}
});

test('loadTasks - loads existing tasks from file', async t => {
	const env = await setupTestEnv('load-existing');
	try {
		const taskData: Task[] = [
			{
				id: 'test-id1',
				title: 'Test Task 1',
				status: 'pending',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
			},
			{
				id: 'test-id2',
				title: 'Test Task 2',
				description: 'With description',
				status: 'completed',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-02T00:00:00.000Z',
				completedAt: '2024-01-02T00:00:00.000Z',
			},
		];

		const dir = join(env.dir, '.nanocoder');
		await mkdir(dir, {recursive: true});
		await writeFile(join(dir, 'tasks.json'), JSON.stringify(taskData), 'utf-8');

		const {loadTasks} = await import('./storage.js');
		const tasks = await loadTasks();
		t.deepEqual(tasks, taskData);
	} finally {
		env.restore();
	}
});

test('loadTasks - returns empty array on invalid JSON', async t => {
	const env = await setupTestEnv('load-invalid-json');
	try {
		const dir = join(env.dir, '.nanocoder');
		await mkdir(dir, {recursive: true});
		await writeFile(join(dir, 'tasks.json'), 'not valid json', 'utf-8');

		const {loadTasks} = await import('./storage.js');
		const tasks = await loadTasks();
		t.deepEqual(tasks, []);
	} finally {
		env.restore();
	}
});

// ============================================================================
// saveTasks Tests
// ============================================================================

test('saveTasks - creates directory and file if not exists', async t => {
	const env = await setupTestEnv('save-create-dir');
	try {
		const {saveTasks, getTasksPath} = await import('./storage.js');
		const tasks: Task[] = [
			{
				id: 'new-task',
				title: 'New Task',
				status: 'pending',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
			},
		];

		await saveTasks(tasks);

		const content = await readFile(getTasksPath(), 'utf-8');
		const saved = JSON.parse(content);
		t.deepEqual(saved, tasks);
	} finally {
		env.restore();
	}
});

test('saveTasks - overwrites existing file', async t => {
	const env = await setupTestEnv('save-overwrite');
	try {
		const {saveTasks, loadTasks} = await import('./storage.js');

		const initialTasks: Task[] = [
			{
				id: 'task-1',
				title: 'Task 1',
				status: 'pending',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
			},
		];
		await saveTasks(initialTasks);

		const updatedTasks: Task[] = [
			{
				id: 'task-2',
				title: 'Task 2',
				status: 'completed',
				createdAt: '2024-01-02T00:00:00.000Z',
				updatedAt: '2024-01-02T00:00:00.000Z',
				completedAt: '2024-01-02T00:00:00.000Z',
			},
		];
		await saveTasks(updatedTasks);

		const loaded = await loadTasks();
		t.deepEqual(loaded, updatedTasks);
	} finally {
		env.restore();
	}
});

test('saveTasks - saves with pretty formatting', async t => {
	const env = await setupTestEnv('save-pretty');
	try {
		const {saveTasks, getTasksPath} = await import('./storage.js');
		const tasks: Task[] = [
			{
				id: 'task-1',
				title: 'Task 1',
				status: 'pending',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
			},
		];

		await saveTasks(tasks);

		const content = await readFile(getTasksPath(), 'utf-8');
		// Pretty printed JSON has newlines
		t.true(content.includes('\n'));
		// And indentation
		t.true(content.includes('  '));
	} finally {
		env.restore();
	}
});

// ============================================================================
// clearAllTasks Tests
// ============================================================================

test('clearAllTasks - clears existing tasks', async t => {
	const env = await setupTestEnv('clear-tasks');
	try {
		const {saveTasks, loadTasks, clearAllTasks} = await import('./storage.js');

		const tasks: Task[] = [
			{
				id: 'task-1',
				title: 'Task 1',
				status: 'pending',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
			},
			{
				id: 'task-2',
				title: 'Task 2',
				status: 'in_progress',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
			},
		];
		await saveTasks(tasks);

		await clearAllTasks();

		const loaded = await loadTasks();
		t.deepEqual(loaded, []);
	} finally {
		env.restore();
	}
});

test('clearAllTasks - works when no tasks exist', async t => {
	const env = await setupTestEnv('clear-empty');
	try {
		const {loadTasks, clearAllTasks} = await import('./storage.js');

		await clearAllTasks();

		const loaded = await loadTasks();
		t.deepEqual(loaded, []);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Integration Tests
// ============================================================================

test('storage - full lifecycle: create, update, clear', async t => {
	const env = await setupTestEnv('full-lifecycle');
	try {
		const {saveTasks, loadTasks, clearAllTasks, generateTaskId} = await import(
			'./storage.js'
		);

		// Create tasks
		const task1: Task = {
			id: generateTaskId(),
			title: 'First Task',
			status: 'pending',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		await saveTasks([task1]);

		let loaded = await loadTasks();
		t.is(loaded.length, 1);
		t.is(loaded[0]?.title, 'First Task');

		// Add another task
		const task2: Task = {
			id: generateTaskId(),
			title: 'Second Task',
			description: 'With description',
			status: 'in_progress',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		await saveTasks([task1, task2]);

		loaded = await loadTasks();
		t.is(loaded.length, 2);

		// Update task status
		if (loaded[0]) {
			loaded[0].status = 'completed';
			loaded[0].completedAt = new Date().toISOString();
		}
		await saveTasks(loaded);

		loaded = await loadTasks();
		t.is(loaded[0]?.status, 'completed');
		t.truthy(loaded[0]?.completedAt);

		// Clear all
		await clearAllTasks();
		loaded = await loadTasks();
		t.deepEqual(loaded, []);
	} finally {
		env.restore();
	}
});
