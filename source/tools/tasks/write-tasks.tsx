import React from 'react';

import {TaskListDisplay} from '@/components/task-list-display';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {generateTaskId, loadTasks, saveTasks} from './storage';
import type {Task, TaskStatus} from './types';

interface TaskInput {
	title: string;
	status?: TaskStatus;
	description?: string;
}

interface WriteTasksArgs {
	tasks: TaskInput[];
}

const STATUS_ICON: Record<TaskStatus, string> = {
	pending: '○',
	in_progress: '◐',
	completed: '✓',
};

const executeWriteTasks = async (args: WriteTasksArgs): Promise<string> => {
	const now = new Date().toISOString();

	const tasks: Task[] = args.tasks.map(input => ({
		id: generateTaskId(),
		title: input.title,
		description: input.description,
		status: input.status ?? 'pending',
		createdAt: now,
		updatedAt: now,
		completedAt: input.status === 'completed' ? now : undefined,
	}));

	await saveTasks(tasks);

	if (tasks.length === 0) {
		return 'Task list cleared. No tasks remaining.';
	}

	const counts = {
		pending: tasks.filter(t => t.status === 'pending').length,
		in_progress: tasks.filter(t => t.status === 'in_progress').length,
		completed: tasks.filter(t => t.status === 'completed').length,
	};

	const list = tasks
		.map(t => `  ${STATUS_ICON[t.status]} ${t.title}`)
		.join('\n');

	return `Task list (${counts.pending} pending, ${counts.in_progress} in progress, ${counts.completed} completed):\n${list}`;
};

const writeTasksCoreTool = tool({
	description:
		'Create and track your task list for multi-step work (3+ steps, multiple files, investigation, features, refactors). ' +
		'Pass the COMPLETE list every time — this REPLACES the entire list. ' +
		'To start a task, resend every task with that one marked in_progress. ' +
		'To finish a task, resend every task with it marked completed. ' +
		'To add work, include new tasks alongside the existing ones; to drop work, omit it. ' +
		'Keep at most one task in_progress at a time. Pass an empty array to clear the list.',
	inputSchema: jsonSchema<WriteTasksArgs>({
		type: 'object',
		properties: {
			tasks: {
				type: 'array',
				description:
					'The complete, ordered task list. Replaces any existing tasks.',
				items: {
					type: 'object',
					properties: {
						title: {
							type: 'string',
							description: 'Short description of the task',
						},
						status: {
							type: 'string',
							enum: ['pending', 'in_progress', 'completed'],
							description: 'Task status (defaults to pending)',
						},
						description: {
							type: 'string',
							description: 'Optional longer detail for the task',
						},
					},
					required: ['title'],
				},
			},
		},
		required: ['tasks'],
	}),
	execute: async (args, _options) => {
		return await executeWriteTasks(args);
	},
});

const writeTasksFormatter = async (
	_args: WriteTasksArgs,
	_result?: string,
): Promise<React.ReactElement> => {
	const tasks = await loadTasks();
	return <TaskListDisplay tasks={tasks} title="Tasks" />;
};

const writeTasksValidator = (
	args: WriteTasksArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	if (!Array.isArray(args.tasks)) {
		return Promise.resolve({
			valid: false,
			error: '⚒ tasks must be an array (pass an empty array to clear the list)',
		});
	}

	for (let i = 0; i < args.tasks.length; i++) {
		const title = args.tasks[i]?.title?.trim();

		if (!title) {
			return Promise.resolve({
				valid: false,
				error: `⚒ Task ${i + 1}: title cannot be empty`,
			});
		}

		if (title.length > 200) {
			return Promise.resolve({
				valid: false,
				error: `⚒ Task ${i + 1}: title is too long (max 200 characters)`,
			});
		}
	}

	return Promise.resolve({valid: true});
};

export const writeTasksTool: NanocoderToolExport = {
	name: 'write_tasks' as const,
	tool: writeTasksCoreTool,
	formatter: writeTasksFormatter,
	validator: writeTasksValidator,
	// Task bookkeeping is low risk - never gated.
	approval: false,
};
