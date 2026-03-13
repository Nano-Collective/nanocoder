import {mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {tasksCommand} from './tasks.js';
import {loadTasks, saveTasks} from '@/tools/tasks/storage.js';
import type {Task} from '@/tools/tasks/types.js';

// ============================================================================
// /tasks Command Tests
// ============================================================================
// Tests for the /tasks slash command that provides interactive task management.

let testDir: string;
let originalCwd: typeof process.cwd;

test.before(async () => {
	testDir = join(tmpdir(), `nanocoder-tasks-command-test-${Date.now()}`);
	await mkdir(testDir, {recursive: true});
	originalCwd = process.cwd;
});

test.after.always(async () => {
	process.cwd = originalCwd;
	if (testDir) {
		await rm(testDir, {recursive: true, force: true}).catch(() => {});
	}
});

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

function getSampleTasks(): Task[] {
	return [
		{
			id: 'task-1',
			title: 'First Task',
			status: 'pending',
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-01T00:00:00.000Z',
		},
		{
			id: 'task-2',
			title: 'Second Task',
			status: 'in_progress',
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-02T00:00:00.000Z',
		},
		{
			id: 'task-3',
			title: 'Third Task',
			status: 'completed',
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-03T00:00:00.000Z',
			completedAt: '2024-01-03T00:00:00.000Z',
		},
	];
}

// ============================================================================
// Command Definition Tests
// ============================================================================

test('tasks command has correct name', t => {
	t.is(tasksCommand.name, 'tasks');
});

test('tasks command has description', t => {
	t.truthy(tasksCommand.description);
	t.true(tasksCommand.description.length > 0);
});

test('tasks command has handler function', t => {
	t.is(typeof tasksCommand.handler, 'function');
});

// ============================================================================
// List Tasks Tests (no args)
// ============================================================================

test('handler - lists tasks when no args provided', async t => {
	const env = await setupTestEnv('list-tasks');
	try {
		await saveTasks(getSampleTasks());

		const result = await tasksCommand.handler([]);

		t.truthy(result);
		// Result should be a React element
		t.is(typeof result, 'object');
	} finally {
		env.restore();
	}
});

test('handler - lists tasks when empty task list', async t => {
	const env = await setupTestEnv('list-empty');
	try {
		const result = await tasksCommand.handler([]);

		t.truthy(result);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Add Task Tests
// ============================================================================

test('handler - adds task with "add" subcommand', async t => {
	const env = await setupTestEnv('add-task');
	try {
		await tasksCommand.handler(['add', 'New', 'Task', 'Title']);

		const tasks = await loadTasks();
		t.is(tasks.length, 1);
		t.is(tasks[0]?.title, 'New Task Title');
		t.is(tasks[0]?.status, 'pending');
	} finally {
		env.restore();
	}
});

test('handler - returns error when add has no title', async t => {
	const env = await setupTestEnv('add-no-title');
	try {
		const result = await tasksCommand.handler(['add']);

		t.truthy(result);
		// Should return error component
		const tasks = await loadTasks();
		t.is(tasks.length, 0);
	} finally {
		env.restore();
	}
});

test('handler - adds task to existing list', async t => {
	const env = await setupTestEnv('add-existing');
	try {
		await saveTasks(getSampleTasks());

		await tasksCommand.handler(['add', 'Fourth', 'Task']);

		const tasks = await loadTasks();
		t.is(tasks.length, 4);
		t.is(tasks[3]?.title, 'Fourth Task');
	} finally {
		env.restore();
	}
});

// ============================================================================
// Remove Task Tests
// ============================================================================

test('handler - removes task with "remove" subcommand', async t => {
	const env = await setupTestEnv('remove-task');
	try {
		await saveTasks(getSampleTasks());

		await tasksCommand.handler(['remove', '2']);

		const tasks = await loadTasks();
		t.is(tasks.length, 2);
		t.is(tasks[0]?.id, 'task-1');
		t.is(tasks[1]?.id, 'task-3');
	} finally {
		env.restore();
	}
});

test('handler - removes task with "rm" alias', async t => {
	const env = await setupTestEnv('rm-task');
	try {
		await saveTasks(getSampleTasks());

		await tasksCommand.handler(['rm', '1']);

		const tasks = await loadTasks();
		t.is(tasks.length, 2);
		t.is(tasks[0]?.id, 'task-2');
	} finally {
		env.restore();
	}
});

test('handler - returns error when remove has no number', async t => {
	const env = await setupTestEnv('remove-no-num');
	try {
		await saveTasks(getSampleTasks());

		const result = await tasksCommand.handler(['remove']);

		t.truthy(result);
		// Tasks should remain unchanged
		const tasks = await loadTasks();
		t.is(tasks.length, 3);
	} finally {
		env.restore();
	}
});

test('handler - returns error for invalid task number', async t => {
	const env = await setupTestEnv('remove-invalid');
	try {
		await saveTasks(getSampleTasks());

		const result = await tasksCommand.handler(['remove', 'abc']);

		t.truthy(result);
		const tasks = await loadTasks();
		t.is(tasks.length, 3);
	} finally {
		env.restore();
	}
});

test('handler - returns error for task number 0', async t => {
	const env = await setupTestEnv('remove-zero');
	try {
		await saveTasks(getSampleTasks());

		const result = await tasksCommand.handler(['remove', '0']);

		t.truthy(result);
		const tasks = await loadTasks();
		t.is(tasks.length, 3);
	} finally {
		env.restore();
	}
});

test('handler - returns error for negative task number', async t => {
	const env = await setupTestEnv('remove-negative');
	try {
		await saveTasks(getSampleTasks());

		const result = await tasksCommand.handler(['remove', '-1']);

		t.truthy(result);
		const tasks = await loadTasks();
		t.is(tasks.length, 3);
	} finally {
		env.restore();
	}
});

test('handler - returns error for out of range task number', async t => {
	const env = await setupTestEnv('remove-range');
	try {
		await saveTasks(getSampleTasks());

		const result = await tasksCommand.handler(['remove', '99']);

		t.truthy(result);
		const tasks = await loadTasks();
		t.is(tasks.length, 3);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Clear Tasks Tests
// ============================================================================

test('handler - clears all tasks with "clear" subcommand', async t => {
	const env = await setupTestEnv('clear-tasks');
	try {
		await saveTasks(getSampleTasks());

		await tasksCommand.handler(['clear']);

		const tasks = await loadTasks();
		t.is(tasks.length, 0);
	} finally {
		env.restore();
	}
});

test('handler - clear works when no tasks exist', async t => {
	const env = await setupTestEnv('clear-empty');
	try {
		const result = await tasksCommand.handler(['clear']);

		t.truthy(result);
		const tasks = await loadTasks();
		t.is(tasks.length, 0);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Default Behavior Tests (unknown subcommand = add task)
// ============================================================================

test('handler - treats unknown subcommand as task title', async t => {
	const env = await setupTestEnv('default-add');
	try {
		await tasksCommand.handler(['Fix', 'the', 'bug']);

		const tasks = await loadTasks();
		t.is(tasks.length, 1);
		t.is(tasks[0]?.title, 'Fix the bug');
	} finally {
		env.restore();
	}
});

test('handler - treats single word as task title', async t => {
	const env = await setupTestEnv('single-word');
	try {
		await tasksCommand.handler(['Refactor']);

		const tasks = await loadTasks();
		t.is(tasks.length, 1);
		t.is(tasks[0]?.title, 'Refactor');
	} finally {
		env.restore();
	}
});

// ============================================================================
// Case Insensitivity Tests
// ============================================================================

test('handler - subcommands are case insensitive', async t => {
	const env = await setupTestEnv('case-insensitive');
	try {
		await saveTasks(getSampleTasks());

		await tasksCommand.handler(['ADD', 'New', 'Task']);

		const tasks = await loadTasks();
		t.is(tasks.length, 4);
	} finally {
		env.restore();
	}
});

test('handler - clear is case insensitive', async t => {
	const env = await setupTestEnv('clear-case');
	try {
		await saveTasks(getSampleTasks());

		await tasksCommand.handler(['CLEAR']);

		const tasks = await loadTasks();
		t.is(tasks.length, 0);
	} finally {
		env.restore();
	}
});

test('handler - remove is case insensitive', async t => {
	const env = await setupTestEnv('remove-case');
	try {
		await saveTasks(getSampleTasks());

		await tasksCommand.handler(['REMOVE', '1']);

		const tasks = await loadTasks();
		t.is(tasks.length, 2);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Edge Cases
// ============================================================================

test('handler - handles special characters in task title', async t => {
	const env = await setupTestEnv('special-chars');
	try {
		const specialTitle = 'Task with "quotes" & <brackets>';
		await tasksCommand.handler(['add', ...specialTitle.split(' ')]);

		const tasks = await loadTasks();
		t.is(tasks[0]?.title, specialTitle);
	} finally {
		env.restore();
	}
});

test('handler - generates unique task IDs', async t => {
	const env = await setupTestEnv('unique-ids');
	try {
		await tasksCommand.handler(['Task 1']);
		await tasksCommand.handler(['Task 2']);
		await tasksCommand.handler(['Task 3']);

		const tasks = await loadTasks();
		const ids = tasks.map(t => t.id);
		const uniqueIds = new Set(ids);
		t.is(uniqueIds.size, 3);
	} finally {
		env.restore();
	}
});

test('handler - sets proper timestamps on new task', async t => {
	const env = await setupTestEnv('timestamps');
	try {
		const before = new Date().toISOString();
		await tasksCommand.handler(['New', 'Task']);
		const after = new Date().toISOString();

		const tasks = await loadTasks();
		t.truthy(tasks[0]?.createdAt);
		t.truthy(tasks[0]?.updatedAt);
		t.true(tasks[0]!.createdAt >= before);
		t.true(tasks[0]!.createdAt <= after);
		t.is(tasks[0]?.createdAt, tasks[0]?.updatedAt);
	} finally {
		env.restore();
	}
});
