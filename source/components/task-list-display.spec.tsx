import test from 'ava';
import React from 'react';
import type {Task} from '@/tools/tasks/types';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import {TaskListDisplay} from './task-list-display';

const makeTasks = (titles: string[]): Task[] =>
	titles.map((title, i) => ({
		id: `task-${i}`,
		title,
		status: 'pending' as const,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	}));

// ============================================================================
// Basic rendering
// ============================================================================

test('TaskListDisplay renders task titles', t => {
	const tasks = makeTasks(['Fix the bug', 'Write tests']);
	const {lastFrame, unmount} = renderWithTheme(
		<TaskListDisplay tasks={tasks} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Tasks/);
	t.regex(output!, /Fix the bug/);
	t.regex(output!, /Write tests/);
	unmount();
});

test('TaskListDisplay renders empty state', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<TaskListDisplay tasks={[]} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /No tasks found/);
	unmount();
});

test('TaskListDisplay renders custom title', t => {
	const tasks = makeTasks(['A task']);
	const {lastFrame, unmount} = renderWithTheme(
		<TaskListDisplay tasks={tasks} title="My Custom Title" />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /My Custom Title/);
	unmount();
});

// ============================================================================
// Truncation
// ============================================================================

test('TaskListDisplay truncates long task titles instead of wrapping', t => {
	// This title is deliberately longer than any reasonable terminal width
	const longTitle =
		'This is a very long task title that should be truncated on narrow terminals instead of wrapping to the next line and looking bad';
	const tasks = makeTasks([longTitle]);
	const {lastFrame, unmount} = renderWithTheme(
		<TaskListDisplay tasks={tasks} />,
	);

	const output = lastFrame();
	t.truthy(output);

	// The output should contain an ellipsis character from truncation
	// and should NOT contain the full title (it should be cut off)
	const lines = output!.split('\n');
	// Find the line with the task (has the status icon and number)
	const taskLine = lines.find(l => l.includes('1.'));
	t.truthy(taskLine, 'Should find the task line');
	t.true(
		taskLine!.includes('…') || !taskLine!.includes('looking bad'),
		'Long title should be truncated, not fully displayed',
	);
	unmount();
});

test('TaskListDisplay does not truncate short task titles', t => {
	const tasks = makeTasks(['Short title']);
	const {lastFrame, unmount} = renderWithTheme(
		<TaskListDisplay tasks={tasks} />,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Short title/);
	// Should NOT have truncation ellipsis for short titles
	const lines = output!.split('\n');
	const taskLine = lines.find(l => l.includes('1.'));
	t.truthy(taskLine);
	t.false(taskLine!.includes('…'), 'Short title should not be truncated');
	unmount();
});
