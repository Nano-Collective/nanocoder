import {mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {createTaskTool} from './create-task.js';
import {loadTasks, saveTasks} from './storage.js';
import type {Task} from './types.js';

// ============================================================================
// Create Task Tool Tests
// ============================================================================
// Tests for the create_task tool that allows creating one or more tasks.

let testDir: string;
let originalCwd: typeof process.cwd;

test.before(async () => {
	testDir = join(tmpdir(), `nanocoder-create-task-test-${Date.now()}`);
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

// ============================================================================
// Tool Definition Tests
// ============================================================================

test('create_task - tool name is correct', t => {
	t.is(createTaskTool.name, 'create_task');
});

test('create_task - has tool definition', t => {
	t.truthy(createTaskTool.tool);
});

test('create_task - has formatter', t => {
	t.truthy(createTaskTool.formatter);
});

test('create_task - has validator', t => {
	t.truthy(createTaskTool.validator);
});

test('create_task - needsApproval is false', t => {
	t.is(createTaskTool.tool.needsApproval, false);
});

// ============================================================================
// Validator Tests
// ============================================================================

test('validator - rejects empty tasks array', async t => {
	const result = await createTaskTool.validator!({tasks: []});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /at least one task/i);
	}
});

test('validator - rejects missing tasks', async t => {
	const result = await createTaskTool.validator!({} as any);
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /at least one task/i);
	}
});

test('validator - rejects empty title', async t => {
	const result = await createTaskTool.validator!({
		tasks: [{title: ''}],
	});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /title cannot be empty/i);
	}
});

test('validator - rejects whitespace-only title', async t => {
	const result = await createTaskTool.validator!({
		tasks: [{title: '   '}],
	});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /title cannot be empty/i);
	}
});

test('validator - rejects title over 200 characters', async t => {
	const result = await createTaskTool.validator!({
		tasks: [{title: 'x'.repeat(201)}],
	});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /too long/i);
	}
});

test('validator - accepts title exactly 200 characters', async t => {
	const result = await createTaskTool.validator!({
		tasks: [{title: 'x'.repeat(200)}],
	});
	t.true(result.valid);
});

test('validator - accepts valid single task', async t => {
	const result = await createTaskTool.validator!({
		tasks: [{title: 'Valid Task'}],
	});
	t.true(result.valid);
});

test('validator - accepts task with description', async t => {
	const result = await createTaskTool.validator!({
		tasks: [{title: 'Task', description: 'A description'}],
	});
	t.true(result.valid);
});

test('validator - accepts multiple valid tasks', async t => {
	const result = await createTaskTool.validator!({
		tasks: [
			{title: 'Task 1'},
			{title: 'Task 2', description: 'Description'},
			{title: 'Task 3'},
		],
	});
	t.true(result.valid);
});

test('validator - rejects if any task in array is invalid', async t => {
	const result = await createTaskTool.validator!({
		tasks: [
			{title: 'Valid Task'},
			{title: ''}, // invalid
			{title: 'Another Valid Task'},
		],
	});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /Task 2/i);
	}
});

// ============================================================================
// Execute Tests
// ============================================================================

test('execute - creates single task', async t => {
	const env = await setupTestEnv('exec-single');
	try {
		const result = (await createTaskTool.tool.execute!(
			{tasks: [{title: 'Test Task'}]},
			{toolCallId: 'test-1', messages: []},
		)) as string;

		t.regex(result, /Created 1 task/);
		t.regex(result, /Test Task/);

		const tasks = await loadTasks();
		t.is(tasks.length, 1);
		t.is(tasks[0]?.title, 'Test Task');
		t.is(tasks[0]?.status, 'pending');
		t.truthy(tasks[0]?.id);
		t.truthy(tasks[0]?.createdAt);
		t.truthy(tasks[0]?.updatedAt);
	} finally {
		env.restore();
	}
});

test('execute - creates task with description', async t => {
	const env = await setupTestEnv('exec-desc');
	try {
		await createTaskTool.tool.execute!(
			{tasks: [{title: 'Task', description: 'Detailed description'}]},
			{toolCallId: 'test-2', messages: []},
		);

		const tasks = await loadTasks();
		t.is(tasks[0]?.description, 'Detailed description');
	} finally {
		env.restore();
	}
});

test('execute - creates multiple tasks', async t => {
	const env = await setupTestEnv('exec-multiple');
	try {
		const result = (await createTaskTool.tool.execute!(
			{
				tasks: [
					{title: 'Task 1'},
					{title: 'Task 2', description: 'Desc 2'},
					{title: 'Task 3'},
				],
			},
			{toolCallId: 'test-3', messages: []},
		)) as string;

		t.regex(result, /Created 3 task/);

		const tasks = await loadTasks();
		t.is(tasks.length, 3);
		t.is(tasks[0]?.title, 'Task 1');
		t.is(tasks[1]?.title, 'Task 2');
		t.is(tasks[1]?.description, 'Desc 2');
		t.is(tasks[2]?.title, 'Task 3');
	} finally {
		env.restore();
	}
});

test('execute - appends to existing tasks', async t => {
	const env = await setupTestEnv('exec-append');
	try {
		const existingTask: Task = {
			id: 'existing-id',
			title: 'Existing Task',
			status: 'in_progress',
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-01T00:00:00.000Z',
		};
		await saveTasks([existingTask]);

		await createTaskTool.tool.execute!(
			{tasks: [{title: 'New Task'}]},
			{toolCallId: 'test-4', messages: []},
		);

		const tasks = await loadTasks();
		t.is(tasks.length, 2);
		t.is(tasks[0]?.id, 'existing-id');
		t.is(tasks[0]?.title, 'Existing Task');
		t.is(tasks[1]?.title, 'New Task');
	} finally {
		env.restore();
	}
});

test('execute - generates unique IDs for each task', async t => {
	const env = await setupTestEnv('exec-unique-ids');
	try {
		await createTaskTool.tool.execute!(
			{
				tasks: [
					{title: 'Task 1'},
					{title: 'Task 2'},
					{title: 'Task 3'},
				],
			},
			{toolCallId: 'test-5', messages: []},
		);

		const tasks = await loadTasks();
		const ids = tasks.map(t => t.id);
		const uniqueIds = new Set(ids);
		t.is(uniqueIds.size, 3);
	} finally {
		env.restore();
	}
});

test('execute - sets createdAt and updatedAt to same timestamp', async t => {
	const env = await setupTestEnv('exec-timestamps');
	try {
		await createTaskTool.tool.execute!(
			{tasks: [{title: 'Task'}]},
			{toolCallId: 'test-6', messages: []},
		);

		const tasks = await loadTasks();
		t.is(tasks[0]?.createdAt, tasks[0]?.updatedAt);
	} finally {
		env.restore();
	}
});

test('execute - returns summary with counts', async t => {
	const env = await setupTestEnv('exec-counts');
	try {
		// Create some existing tasks with different statuses
		const existingTasks: Task[] = [
			{
				id: 'id1',
				title: 'Completed',
				status: 'completed',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
			},
			{
				id: 'id2',
				title: 'In Progress',
				status: 'in_progress',
				createdAt: '2024-01-01T00:00:00.000Z',
				updatedAt: '2024-01-01T00:00:00.000Z',
			},
		];
		await saveTasks(existingTasks);

		const result = (await createTaskTool.tool.execute!(
			{tasks: [{title: 'New Pending'}]},
			{toolCallId: 'test-7', messages: []},
		)) as string;

		t.regex(result, /1 pending/);
		t.regex(result, /1 in progress/);
		t.regex(result, /1 completed/);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Edge Cases
// ============================================================================

test('execute - handles special characters in title', async t => {
	const env = await setupTestEnv('exec-special-chars');
	try {
		const specialTitle = 'Task with "quotes" & <brackets> and émojis 🎉';
		await createTaskTool.tool.execute!(
			{tasks: [{title: specialTitle}]},
			{toolCallId: 'test-8', messages: []},
		);

		const tasks = await loadTasks();
		t.is(tasks[0]?.title, specialTitle);
	} finally {
		env.restore();
	}
});

test('execute - handles newlines in description', async t => {
	const env = await setupTestEnv('exec-newlines');
	try {
		const description = 'Line 1\nLine 2\nLine 3';
		await createTaskTool.tool.execute!(
			{tasks: [{title: 'Task', description}]},
			{toolCallId: 'test-9', messages: []},
		);

		const tasks = await loadTasks();
		t.is(tasks[0]?.description, description);
	} finally {
		env.restore();
	}
});
