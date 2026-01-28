import {mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {deleteTaskTool} from './delete-task.js';
import {loadTasks, saveTasks} from './storage.js';
import type {Task} from './types.js';

// ============================================================================
// Delete Task Tool Tests
// ============================================================================
// Tests for the delete_task tool that deletes tasks by ID or clears all tasks.

let testDir: string;
let originalCwd: typeof process.cwd;

test.before(async () => {
	testDir = join(tmpdir(), `nanocoder-delete-task-test-${Date.now()}`);
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
			description: 'Has description',
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
// Tool Definition Tests
// ============================================================================

test('delete_task - tool name is correct', t => {
	t.is(deleteTaskTool.name, 'delete_task');
});

test('delete_task - has tool definition', t => {
	t.truthy(deleteTaskTool.tool);
});

test('delete_task - has formatter', t => {
	t.truthy(deleteTaskTool.formatter);
});

test('delete_task - has validator', t => {
	t.truthy(deleteTaskTool.validator);
});

test('delete_task - needsApproval is false', t => {
	t.is(deleteTaskTool.tool.needsApproval, false);
});

// ============================================================================
// Validator Tests
// ============================================================================

test('validator - rejects empty args', async t => {
	const result = await deleteTaskTool.validator!({});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /either ids.*or clear_all/i);
	}
});

test('validator - rejects empty ids array without clear_all', async t => {
	const result = await deleteTaskTool.validator!({ids: []});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /either ids.*or clear_all/i);
	}
});

test('validator - rejects both ids and clear_all', async t => {
	const result = await deleteTaskTool.validator!({
		ids: ['task-1'],
		clear_all: true,
	});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /cannot specify both/i);
	}
});

test('validator - accepts valid ids array', async t => {
	const result = await deleteTaskTool.validator!({ids: ['task-1']});
	t.true(result.valid);
});

test('validator - accepts multiple ids', async t => {
	const result = await deleteTaskTool.validator!({
		ids: ['task-1', 'task-2', 'task-3'],
	});
	t.true(result.valid);
});

test('validator - accepts clear_all true', async t => {
	const result = await deleteTaskTool.validator!({clear_all: true});
	t.true(result.valid);
});

test('validator - rejects clear_all false without ids', async t => {
	const result = await deleteTaskTool.validator!({clear_all: false});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /either ids.*or clear_all/i);
	}
});

// ============================================================================
// Execute Tests - Delete by IDs
// ============================================================================

test('execute - deletes single task', async t => {
	const env = await setupTestEnv('exec-single');
	try {
		await saveTasks(getSampleTasks());

		const result = (await deleteTaskTool.tool.execute!(
			{ids: ['task-1']},
			{toolCallId: 'test-1', messages: []},
		)) as string;

		t.regex(result, /Deleted 1 task/);
		t.regex(result, /task-1/);

		const tasks = await loadTasks();
		t.is(tasks.length, 2);
		t.false(tasks.some(t => t.id === 'task-1'));
	} finally {
		env.restore();
	}
});

test('execute - deletes multiple tasks', async t => {
	const env = await setupTestEnv('exec-multiple');
	try {
		await saveTasks(getSampleTasks());

		const result = (await deleteTaskTool.tool.execute!(
			{ids: ['task-1', 'task-3']},
			{toolCallId: 'test-2', messages: []},
		)) as string;

		t.regex(result, /Deleted 2 task/);

		const tasks = await loadTasks();
		t.is(tasks.length, 1);
		t.is(tasks[0]?.id, 'task-2');
	} finally {
		env.restore();
	}
});

test('execute - deletes all tasks when all IDs provided', async t => {
	const env = await setupTestEnv('exec-all-ids');
	try {
		await saveTasks(getSampleTasks());

		const result = (await deleteTaskTool.tool.execute!(
			{ids: ['task-1', 'task-2', 'task-3']},
			{toolCallId: 'test-3', messages: []},
		)) as string;

		t.regex(result, /Deleted 3 task/);
		t.regex(result, /No tasks remaining/);

		const tasks = await loadTasks();
		t.is(tasks.length, 0);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Execute Tests - Clear All
// ============================================================================

test('execute - clears all tasks with clear_all', async t => {
	const env = await setupTestEnv('exec-clear-all');
	try {
		await saveTasks(getSampleTasks());

		const result = (await deleteTaskTool.tool.execute!(
			{clear_all: true},
			{toolCallId: 'test-4', messages: []},
		)) as string;

		t.regex(result, /Cleared all 3 task/);
		t.regex(result, /No tasks remaining/);

		const tasks = await loadTasks();
		t.is(tasks.length, 0);
	} finally {
		env.restore();
	}
});

test('execute - clear_all works when no tasks exist', async t => {
	const env = await setupTestEnv('exec-clear-empty');
	try {
		const result = (await deleteTaskTool.tool.execute!(
			{clear_all: true},
			{toolCallId: 'test-5', messages: []},
		)) as string;

		t.regex(result, /Cleared all 0 task/);
		t.regex(result, /No tasks remaining/);

		const tasks = await loadTasks();
		t.is(tasks.length, 0);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Execute Tests - Non-Existent IDs
// ============================================================================

test('execute - handles non-existent task ID', async t => {
	const env = await setupTestEnv('exec-not-found');
	try {
		await saveTasks(getSampleTasks());

		const result = (await deleteTaskTool.tool.execute!(
			{ids: ['non-existent']},
			{toolCallId: 'test-6', messages: []},
		)) as string;

		t.regex(result, /Task not found.*non-existent/i);

		// Other tasks should remain unchanged
		const tasks = await loadTasks();
		t.is(tasks.length, 3);
	} finally {
		env.restore();
	}
});

test('execute - handles mix of existing and non-existent IDs', async t => {
	const env = await setupTestEnv('exec-partial');
	try {
		await saveTasks(getSampleTasks());

		const result = (await deleteTaskTool.tool.execute!(
			{ids: ['task-1', 'non-existent', 'task-3']},
			{toolCallId: 'test-7', messages: []},
		)) as string;

		t.regex(result, /Deleted 3 task/);
		t.regex(result, /Task not found.*non-existent/i);

		const tasks = await loadTasks();
		t.is(tasks.length, 1);
		t.is(tasks[0]?.id, 'task-2');
	} finally {
		env.restore();
	}
});

// ============================================================================
// Execute Tests - Output Format
// ============================================================================

test('execute - shows deleted task titles', async t => {
	const env = await setupTestEnv('exec-titles');
	try {
		await saveTasks(getSampleTasks());

		const result = (await deleteTaskTool.tool.execute!(
			{ids: ['task-1']},
			{toolCallId: 'test-8', messages: []},
		)) as string;

		t.regex(result, /First Task/);
	} finally {
		env.restore();
	}
});

test('execute - shows remaining tasks', async t => {
	const env = await setupTestEnv('exec-remaining');
	try {
		await saveTasks(getSampleTasks());

		const result = (await deleteTaskTool.tool.execute!(
			{ids: ['task-1']},
			{toolCallId: 'test-9', messages: []},
		)) as string;

		t.regex(result, /Remaining Tasks/);
		t.regex(result, /Second Task/);
		t.regex(result, /Third Task/);
	} finally {
		env.restore();
	}
});

test('execute - shows task counts in output', async t => {
	const env = await setupTestEnv('exec-counts');
	try {
		await saveTasks(getSampleTasks());

		const result = (await deleteTaskTool.tool.execute!(
			{ids: ['task-1']},
			{toolCallId: 'test-10', messages: []},
		)) as string;

		t.regex(result, /pending/);
		t.regex(result, /in progress/);
		t.regex(result, /completed/);
	} finally {
		env.restore();
	}
});

test('execute - shows status icons for remaining tasks', async t => {
	const env = await setupTestEnv('exec-icons');
	try {
		await saveTasks(getSampleTasks());

		const result = (await deleteTaskTool.tool.execute!(
			{ids: ['task-1']},
			{toolCallId: 'test-11', messages: []},
		)) as string;

		// ◐ for in_progress (task-2), ✓ for completed (task-3)
		t.regex(result, /◐/);
		t.regex(result, /✓/);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Execute Tests - Error Handling
// ============================================================================

test('execute - throws error when neither ids nor clear_all', async t => {
	const env = await setupTestEnv('exec-error');
	try {
		await saveTasks(getSampleTasks());

		await t.throwsAsync(
			async () => {
				await deleteTaskTool.tool.execute!(
					{ids: []},
					{toolCallId: 'test-12', messages: []},
				);
			},
			{message: /either ids or clear_all must be provided/i},
		);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Edge Cases
// ============================================================================

test('execute - handles duplicate IDs in array', async t => {
	const env = await setupTestEnv('exec-duplicates');
	try {
		await saveTasks(getSampleTasks());

		const result = (await deleteTaskTool.tool.execute!(
			{ids: ['task-1', 'task-1', 'task-1']},
			{toolCallId: 'test-13', messages: []},
		)) as string;

		t.regex(result, /Deleted 3 task/);
		// Only one task should actually be deleted
		const tasks = await loadTasks();
		t.is(tasks.length, 2);
	} finally {
		env.restore();
	}
});

test('execute - preserves task order for remaining tasks', async t => {
	const env = await setupTestEnv('exec-order');
	try {
		await saveTasks(getSampleTasks());

		await deleteTaskTool.tool.execute!(
			{ids: ['task-2']},
			{toolCallId: 'test-14', messages: []},
		);

		const tasks = await loadTasks();
		t.is(tasks.length, 2);
		t.is(tasks[0]?.id, 'task-1');
		t.is(tasks[1]?.id, 'task-3');
	} finally {
		env.restore();
	}
});

test('execute - handles single task delete leaving zero', async t => {
	const env = await setupTestEnv('exec-last-task');
	try {
		const tasks: Task[] = [
			{
				id: 'only-task',
				title: 'Only Task',
				status: 'pending',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
			},
		];
		await saveTasks(tasks);

		const result = (await deleteTaskTool.tool.execute!(
			{ids: ['only-task']},
			{toolCallId: 'test-15', messages: []},
		)) as string;

		t.regex(result, /Deleted 1 task/);
		t.regex(result, /No tasks remaining/);

		const remaining = await loadTasks();
		t.is(remaining.length, 0);
	} finally {
		env.restore();
	}
});
