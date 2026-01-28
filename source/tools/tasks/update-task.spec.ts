import {mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {loadTasks, saveTasks} from './storage.js';
import type {Task} from './types.js';
import {updateTaskTool} from './update-task.js';

// ============================================================================
// Update Task Tool Tests
// ============================================================================
// Tests for the update_task tool that updates task status, title, or description.

let testDir: string;
let originalCwd: typeof process.cwd;

test.before(async () => {
	testDir = join(tmpdir(), `nanocoder-update-task-test-${Date.now()}`);
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

test('update_task - tool name is correct', t => {
	t.is(updateTaskTool.name, 'update_task');
});

test('update_task - has tool definition', t => {
	t.truthy(updateTaskTool.tool);
});

test('update_task - has formatter', t => {
	t.truthy(updateTaskTool.formatter);
});

test('update_task - has validator', t => {
	t.truthy(updateTaskTool.validator);
});

test('update_task - needsApproval is false', t => {
	t.is(updateTaskTool.tool.needsApproval, false);
});

// ============================================================================
// Validator Tests
// ============================================================================

test('validator - rejects empty updates array', async t => {
	const result = await updateTaskTool.validator!({updates: []});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /at least one update/i);
	}
});

test('validator - rejects missing updates', async t => {
	const result = await updateTaskTool.validator!({} as any);
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /at least one update/i);
	}
});

test('validator - rejects missing task ID', async t => {
	const result = await updateTaskTool.validator!({
		updates: [{status: 'completed'}],
	} as any);
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /task id is required/i);
	}
});

test('validator - rejects empty task ID', async t => {
	const result = await updateTaskTool.validator!({
		updates: [{id: '', status: 'completed'}],
	});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /task id is required/i);
	}
});

test('validator - rejects whitespace-only task ID', async t => {
	const result = await updateTaskTool.validator!({
		updates: [{id: '   ', status: 'completed'}],
	});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /task id is required/i);
	}
});

test('validator - rejects update with no fields', async t => {
	const result = await updateTaskTool.validator!({
		updates: [{id: 'task-1'}],
	});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /at least one field/i);
	}
});

test('validator - rejects empty title', async t => {
	const result = await updateTaskTool.validator!({
		updates: [{id: 'task-1', title: ''}],
	});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /title cannot be empty/i);
	}
});

test('validator - rejects whitespace-only title', async t => {
	const result = await updateTaskTool.validator!({
		updates: [{id: 'task-1', title: '   '}],
	});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /title cannot be empty/i);
	}
});

test('validator - rejects title over 200 characters', async t => {
	const result = await updateTaskTool.validator!({
		updates: [{id: 'task-1', title: 'x'.repeat(201)}],
	});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /too long/i);
	}
});

test('validator - accepts update with only status', async t => {
	const result = await updateTaskTool.validator!({
		updates: [{id: 'task-1', status: 'completed'}],
	});
	t.true(result.valid);
});

test('validator - accepts update with only title', async t => {
	const result = await updateTaskTool.validator!({
		updates: [{id: 'task-1', title: 'New Title'}],
	});
	t.true(result.valid);
});

test('validator - accepts update with only description', async t => {
	const result = await updateTaskTool.validator!({
		updates: [{id: 'task-1', description: 'New description'}],
	});
	t.true(result.valid);
});

test('validator - accepts update with all fields', async t => {
	const result = await updateTaskTool.validator!({
		updates: [
			{
				id: 'task-1',
				status: 'completed',
				title: 'New Title',
				description: 'New description',
			},
		],
	});
	t.true(result.valid);
});

test('validator - accepts multiple valid updates', async t => {
	const result = await updateTaskTool.validator!({
		updates: [
			{id: 'task-1', status: 'completed'},
			{id: 'task-2', title: 'New Title'},
			{id: 'task-3', description: 'New desc'},
		],
	});
	t.true(result.valid);
});

test('validator - rejects if any update is invalid', async t => {
	const result = await updateTaskTool.validator!({
		updates: [
			{id: 'task-1', status: 'completed'},
			{id: 'task-2'}, // invalid - no fields
			{id: 'task-3', title: 'Title'},
		],
	});
	t.false(result.valid);
	if (!result.valid) {
		t.regex(result.error, /Update 2/i);
	}
});

// ============================================================================
// Execute Tests - Status Updates
// ============================================================================

test('execute - updates task status to completed', async t => {
	const env = await setupTestEnv('exec-complete');
	try {
		await saveTasks(getSampleTasks());

		const result = (await updateTaskTool.tool.execute!(
			{updates: [{id: 'task-1', status: 'completed'}]},
			{toolCallId: 'test-1', messages: []},
		)) as string;

		t.regex(result, /Updated 1 task/);

		const tasks = await loadTasks();
		const task = tasks.find(t => t.id === 'task-1');
		t.is(task?.status, 'completed');
		t.truthy(task?.completedAt);
	} finally {
		env.restore();
	}
});

test('execute - updates task status to in_progress', async t => {
	const env = await setupTestEnv('exec-progress');
	try {
		await saveTasks(getSampleTasks());

		await updateTaskTool.tool.execute!(
			{updates: [{id: 'task-1', status: 'in_progress'}]},
			{toolCallId: 'test-2', messages: []},
		);

		const tasks = await loadTasks();
		const task = tasks.find(t => t.id === 'task-1');
		t.is(task?.status, 'in_progress');
		t.falsy(task?.completedAt);
	} finally {
		env.restore();
	}
});

test('execute - updates task status to pending', async t => {
	const env = await setupTestEnv('exec-pending');
	try {
		await saveTasks(getSampleTasks());

		await updateTaskTool.tool.execute!(
			{updates: [{id: 'task-3', status: 'pending'}]},
			{toolCallId: 'test-3', messages: []},
		);

		const tasks = await loadTasks();
		const task = tasks.find(t => t.id === 'task-3');
		t.is(task?.status, 'pending');
		// completedAt should be cleared
		t.falsy(task?.completedAt);
	} finally {
		env.restore();
	}
});

test('execute - clears completedAt when changing from completed', async t => {
	const env = await setupTestEnv('exec-clear-completed');
	try {
		await saveTasks(getSampleTasks());

		await updateTaskTool.tool.execute!(
			{updates: [{id: 'task-3', status: 'in_progress'}]},
			{toolCallId: 'test-4', messages: []},
		);

		const tasks = await loadTasks();
		const task = tasks.find(t => t.id === 'task-3');
		t.is(task?.status, 'in_progress');
		t.is(task?.completedAt, undefined);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Execute Tests - Title and Description Updates
// ============================================================================

test('execute - updates task title', async t => {
	const env = await setupTestEnv('exec-title');
	try {
		await saveTasks(getSampleTasks());

		await updateTaskTool.tool.execute!(
			{updates: [{id: 'task-1', title: 'Updated Title'}]},
			{toolCallId: 'test-5', messages: []},
		);

		const tasks = await loadTasks();
		const task = tasks.find(t => t.id === 'task-1');
		t.is(task?.title, 'Updated Title');
	} finally {
		env.restore();
	}
});

test('execute - updates task description', async t => {
	const env = await setupTestEnv('exec-desc');
	try {
		await saveTasks(getSampleTasks());

		await updateTaskTool.tool.execute!(
			{updates: [{id: 'task-1', description: 'New description'}]},
			{toolCallId: 'test-6', messages: []},
		);

		const tasks = await loadTasks();
		const task = tasks.find(t => t.id === 'task-1');
		t.is(task?.description, 'New description');
	} finally {
		env.restore();
	}
});

test('execute - updates multiple fields at once', async t => {
	const env = await setupTestEnv('exec-multi-field');
	try {
		await saveTasks(getSampleTasks());

		await updateTaskTool.tool.execute!(
			{
				updates: [
					{
						id: 'task-1',
						status: 'completed',
						title: 'New Title',
						description: 'New desc',
					},
				],
			},
			{toolCallId: 'test-7', messages: []},
		);

		const tasks = await loadTasks();
		const task = tasks.find(t => t.id === 'task-1');
		t.is(task?.status, 'completed');
		t.is(task?.title, 'New Title');
		t.is(task?.description, 'New desc');
		t.truthy(task?.completedAt);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Execute Tests - Multiple Updates
// ============================================================================

test('execute - updates multiple tasks', async t => {
	const env = await setupTestEnv('exec-multi-task');
	try {
		await saveTasks(getSampleTasks());

		const result = (await updateTaskTool.tool.execute!(
			{
				updates: [
					{id: 'task-1', status: 'in_progress'},
					{id: 'task-2', status: 'completed'},
				],
			},
			{toolCallId: 'test-8', messages: []},
		)) as string;

		t.regex(result, /Updated 2 task/);

		const tasks = await loadTasks();
		const task1 = tasks.find(t => t.id === 'task-1');
		const task2 = tasks.find(t => t.id === 'task-2');
		t.is(task1?.status, 'in_progress');
		t.is(task2?.status, 'completed');
	} finally {
		env.restore();
	}
});

// ============================================================================
// Execute Tests - Error Handling
// ============================================================================

test('execute - handles non-existent task ID', async t => {
	const env = await setupTestEnv('exec-not-found');
	try {
		await saveTasks(getSampleTasks());

		const result = (await updateTaskTool.tool.execute!(
			{updates: [{id: 'non-existent', status: 'completed'}]},
			{toolCallId: 'test-9', messages: []},
		)) as string;

		t.regex(result, /Task not found.*non-existent/i);
	} finally {
		env.restore();
	}
});

test('execute - continues with other updates after not found', async t => {
	const env = await setupTestEnv('exec-partial');
	try {
		await saveTasks(getSampleTasks());

		const result = (await updateTaskTool.tool.execute!(
			{
				updates: [
					{id: 'task-1', status: 'completed'},
					{id: 'non-existent', status: 'completed'},
					{id: 'task-2', status: 'completed'},
				],
			},
			{toolCallId: 'test-10', messages: []},
		)) as string;

		t.regex(result, /Task not found.*non-existent/i);

		const tasks = await loadTasks();
		const task1 = tasks.find(t => t.id === 'task-1');
		const task2 = tasks.find(t => t.id === 'task-2');
		t.is(task1?.status, 'completed');
		t.is(task2?.status, 'completed');
	} finally {
		env.restore();
	}
});

// ============================================================================
// Execute Tests - Timestamps
// ============================================================================

test('execute - updates updatedAt timestamp', async t => {
	const env = await setupTestEnv('exec-timestamp');
	try {
		await saveTasks(getSampleTasks());
		const before = new Date().toISOString();

		await updateTaskTool.tool.execute!(
			{updates: [{id: 'task-1', status: 'in_progress'}]},
			{toolCallId: 'test-11', messages: []},
		);

		const tasks = await loadTasks();
		const task = tasks.find(t => t.id === 'task-1');
		t.truthy(task?.updatedAt);
		t.true(task!.updatedAt >= before);
	} finally {
		env.restore();
	}
});

test('execute - preserves createdAt timestamp', async t => {
	const env = await setupTestEnv('exec-preserve-created');
	try {
		await saveTasks(getSampleTasks());

		await updateTaskTool.tool.execute!(
			{updates: [{id: 'task-1', status: 'completed'}]},
			{toolCallId: 'test-12', messages: []},
		);

		const tasks = await loadTasks();
		const task = tasks.find(t => t.id === 'task-1');
		t.is(task?.createdAt, '2024-01-01T00:00:00.000Z');
	} finally {
		env.restore();
	}
});

// ============================================================================
// Execute Tests - Output Format
// ============================================================================

test('execute - includes status icons in output', async t => {
	const env = await setupTestEnv('exec-icons');
	try {
		await saveTasks(getSampleTasks());

		const result = (await updateTaskTool.tool.execute!(
			{updates: [{id: 'task-1', status: 'completed'}]},
			{toolCallId: 'test-13', messages: []},
		)) as string;

		t.regex(result, /✓/);
	} finally {
		env.restore();
	}
});

test('execute - includes task counts in output', async t => {
	const env = await setupTestEnv('exec-counts');
	try {
		await saveTasks(getSampleTasks());

		const result = (await updateTaskTool.tool.execute!(
			{updates: [{id: 'task-1', status: 'completed'}]},
			{toolCallId: 'test-14', messages: []},
		)) as string;

		t.regex(result, /pending/);
		t.regex(result, /in progress/);
		t.regex(result, /completed/);
	} finally {
		env.restore();
	}
});

// ============================================================================
// Edge Cases
// ============================================================================

test('execute - handles special characters in title update', async t => {
	const env = await setupTestEnv('exec-special');
	try {
		await saveTasks(getSampleTasks());

		const specialTitle = 'Updated "title" with <special> & chars 🎉';
		await updateTaskTool.tool.execute!(
			{updates: [{id: 'task-1', title: specialTitle}]},
			{toolCallId: 'test-15', messages: []},
		);

		const tasks = await loadTasks();
		const task = tasks.find(t => t.id === 'task-1');
		t.is(task?.title, specialTitle);
	} finally {
		env.restore();
	}
});

test('execute - handles empty description update', async t => {
	const env = await setupTestEnv('exec-empty-desc');
	try {
		await saveTasks(getSampleTasks());

		// Empty string for description should be allowed (to clear description)
		await updateTaskTool.tool.execute!(
			{updates: [{id: 'task-2', description: ''}]},
			{toolCallId: 'test-16', messages: []},
		);

		const tasks = await loadTasks();
		const task = tasks.find(t => t.id === 'task-2');
		t.is(task?.description, '');
	} finally {
		env.restore();
	}
});
