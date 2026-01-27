import {mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {listTasksTool} from './list-tasks.js';
import {saveTasks} from './storage.js';
import type {Task} from './types.js';

// ============================================================================
// List Tasks Tool Tests
// ============================================================================
// Tests for the list_tasks tool that lists tasks with optional filtering.

let testDir: string;
let originalCwd: typeof process.cwd;

test.before(async () => {
	testDir = join(tmpdir(), `nanocoder-list-tasks-test-${Date.now()}`);
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

// Sample tasks for testing
function getSampleTasks(): Task[] {
	return [
		{
			id: 'pending-1',
			title: 'Pending Task 1',
			status: 'pending',
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-01T00:00:00.000Z',
		},
		{
			id: 'pending-2',
			title: 'Pending Task 2',
			description: 'Has description',
			status: 'pending',
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-01T00:00:00.000Z',
		},
		{
			id: 'progress-1',
			title: 'In Progress Task',
			status: 'in_progress',
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-02T00:00:00.000Z',
		},
		{
			id: 'completed-1',
			title: 'Completed Task',
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

test('list_tasks - tool name is correct', t => {
	t.is(listTasksTool.name, 'list_tasks');
});

test('list_tasks - has tool definition', t => {
	t.truthy(listTasksTool.tool);
});

test('list_tasks - has formatter', t => {
	t.truthy(listTasksTool.formatter);
});

test('list_tasks - has no validator (read-only operation)', t => {
	t.falsy(listTasksTool.validator);
});

test('list_tasks - needsApproval is false', t => {
	t.is(listTasksTool.tool.needsApproval, false);
});

// ============================================================================
// Execute Tests - No Tasks
// ============================================================================

test('execute - returns message when no tasks exist', async t => {
	const env = await setupTestEnv('exec-no-tasks');
	try {
		const result = (await listTasksTool.tool.execute!(
			{},
			{toolCallId: 'test-1', messages: []},
		)) as string;

		t.regex(result, /no tasks found/i);
		t.regex(result, /create one with create_task/i);
	} finally {
		env.restore();
	}
});

test('execute - returns message when no tasks match filter', async t => {
	const env = await setupTestEnv('exec-no-match');
	try {
		const tasks: Task[] = [
			{
				id: 'pending-1',
				title: 'Pending Task',
				status: 'pending',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
			},
		];
		await saveTasks(tasks);

		const result = (await listTasksTool.tool.execute!(
			{status: 'completed'},
			{toolCallId: 'test-2', messages: []},
		)) as string;

		t.regex(result, /no tasks with status "completed"/i);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Execute Tests - Filtering
// ============================================================================

test('execute - lists all tasks by default', async t => {
	const env = await setupTestEnv('exec-all-default');
	try {
		await saveTasks(getSampleTasks());

		const result = (await listTasksTool.tool.execute!(
			{},
			{toolCallId: 'test-3', messages: []},
		)) as string;

		t.regex(result, /Pending Task 1/);
		t.regex(result, /Pending Task 2/);
		t.regex(result, /In Progress Task/);
		t.regex(result, /Completed Task/);
	} finally {
		env.restore();
	}
});

test('execute - lists all tasks with explicit status=all', async t => {
	const env = await setupTestEnv('exec-all-explicit');
	try {
		await saveTasks(getSampleTasks());

		const result = (await listTasksTool.tool.execute!(
			{status: 'all'},
			{toolCallId: 'test-4', messages: []},
		)) as string;

		t.regex(result, /Pending Task 1/);
		t.regex(result, /Pending Task 2/);
		t.regex(result, /In Progress Task/);
		t.regex(result, /Completed Task/);
	} finally {
		env.restore();
	}
});

test('execute - filters pending tasks', async t => {
	const env = await setupTestEnv('exec-pending');
	try {
		await saveTasks(getSampleTasks());

		const result = (await listTasksTool.tool.execute!(
			{status: 'pending'},
			{toolCallId: 'test-5', messages: []},
		)) as string;

		t.regex(result, /Pending Task 1/);
		t.regex(result, /Pending Task 2/);
		t.notRegex(result, /In Progress Task/);
		t.notRegex(result, /Completed Task/);
	} finally {
		env.restore();
	}
});

test('execute - filters in_progress tasks', async t => {
	const env = await setupTestEnv('exec-in-progress');
	try {
		await saveTasks(getSampleTasks());

		const result = (await listTasksTool.tool.execute!(
			{status: 'in_progress'},
			{toolCallId: 'test-6', messages: []},
		)) as string;

		t.regex(result, /In Progress Task/);
		t.notRegex(result, /Pending Task 1/);
		t.notRegex(result, /Completed Task/);
	} finally {
		env.restore();
	}
});

test('execute - filters completed tasks', async t => {
	const env = await setupTestEnv('exec-completed');
	try {
		await saveTasks(getSampleTasks());

		const result = (await listTasksTool.tool.execute!(
			{status: 'completed'},
			{toolCallId: 'test-7', messages: []},
		)) as string;

		t.regex(result, /Completed Task/);
		t.notRegex(result, /Pending Task/);
		t.notRegex(result, /In Progress Task/);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Execute Tests - Output Format
// ============================================================================

test('execute - includes status icons', async t => {
	const env = await setupTestEnv('exec-icons');
	try {
		await saveTasks(getSampleTasks());

		const result = (await listTasksTool.tool.execute!(
			{},
			{toolCallId: 'test-8', messages: []},
		)) as string;

		// ○ for pending, ◐ for in_progress, ✓ for completed
		t.regex(result, /○/);
		t.regex(result, /◐/);
		t.regex(result, /✓/);
	} finally {
		env.restore();
	}
});

test('execute - includes task IDs', async t => {
	const env = await setupTestEnv('exec-ids');
	try {
		await saveTasks(getSampleTasks());

		const result = (await listTasksTool.tool.execute!(
			{},
			{toolCallId: 'test-9', messages: []},
		)) as string;

		t.regex(result, /\[pending-1\]/);
		t.regex(result, /\[progress-1\]/);
		t.regex(result, /\[completed-1\]/);
	} finally {
		env.restore();
	}
});

test('execute - includes descriptions when present', async t => {
	const env = await setupTestEnv('exec-descriptions');
	try {
		await saveTasks(getSampleTasks());

		const result = (await listTasksTool.tool.execute!(
			{},
			{toolCallId: 'test-10', messages: []},
		)) as string;

		t.regex(result, /Has description/);
	} finally {
		env.restore();
	}
});

test('execute - includes task counts in header', async t => {
	const env = await setupTestEnv('exec-counts');
	try {
		await saveTasks(getSampleTasks());

		const result = (await listTasksTool.tool.execute!(
			{},
			{toolCallId: 'test-11', messages: []},
		)) as string;

		// 2 pending, 1 in progress, 1 completed
		t.regex(result, /2 pending/);
		t.regex(result, /1 in progress/);
		t.regex(result, /1 completed/);
	} finally {
		env.restore();
	}
});

test('execute - includes separator line', async t => {
	const env = await setupTestEnv('exec-separator');
	try {
		await saveTasks(getSampleTasks());

		const result = (await listTasksTool.tool.execute!(
			{},
			{toolCallId: 'test-12', messages: []},
		)) as string;

		// Should have ─ characters as separator
		t.regex(result, /─+/);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Edge Cases
// ============================================================================

test('execute - handles single task', async t => {
	const env = await setupTestEnv('exec-single');
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

		const result = (await listTasksTool.tool.execute!(
			{},
			{toolCallId: 'test-13', messages: []},
		)) as string;

		t.regex(result, /Only Task/);
		t.regex(result, /1 pending/);
		t.regex(result, /0 in progress/);
		t.regex(result, /0 completed/);
	} finally {
		env.restore();
	}
});

test('execute - handles many tasks', async t => {
	const env = await setupTestEnv('exec-many');
	try {
		const tasks: Task[] = [];
		for (let i = 0; i < 50; i++) {
			tasks.push({
				id: `task-${i}`,
				title: `Task ${i}`,
				status: i % 3 === 0 ? 'pending' : i % 3 === 1 ? 'in_progress' : 'completed',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
			});
		}
		await saveTasks(tasks);

		const result = (await listTasksTool.tool.execute!(
			{},
			{toolCallId: 'test-14', messages: []},
		)) as string;

		t.regex(result, /Task 0/);
		t.regex(result, /Task 49/);
	} finally {
		env.restore();
	}
});

test('execute - handles special characters in title', async t => {
	const env = await setupTestEnv('exec-special');
	try {
		const tasks: Task[] = [
			{
				id: 'special-task',
				title: 'Task with "quotes" & <brackets>',
				status: 'pending',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
			},
		];
		await saveTasks(tasks);

		const result = (await listTasksTool.tool.execute!(
			{},
			{toolCallId: 'test-15', messages: []},
		)) as string;

		t.regex(result, /Task with "quotes" & <brackets>/);
	} finally {
		env.restore();
	}
});
