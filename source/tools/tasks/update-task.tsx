import React from 'react';

import {TaskListDisplay} from '@/components/task-list-display';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {loadTasks, saveTasks} from './storage';
import type {TaskStatus} from './types';

interface TaskUpdate {
	id: string;
	status?: TaskStatus;
	title?: string;
	description?: string;
}

interface UpdateTaskArgs {
	updates: TaskUpdate[];
}

const executeUpdateTask = async (args: UpdateTaskArgs): Promise<string> => {
	const tasks = await loadTasks();
	const now = new Date().toISOString();
	const results: string[] = [];

	for (const update of args.updates) {
		const taskIndex = tasks.findIndex(t => t.id === update.id);
		if (taskIndex === -1) {
			results.push(`  ✗ Task not found: ${update.id}`);
			continue;
		}

		const task = tasks[taskIndex];

		if (update.status !== undefined) {
			task.status = update.status;
			if (update.status === 'completed') {
				task.completedAt = now;
			} else {
				task.completedAt = undefined;
			}
		}

		if (update.title !== undefined) {
			task.title = update.title;
		}

		if (update.description !== undefined) {
			task.description = update.description;
		}

		task.updatedAt = now;
		tasks[taskIndex] = task;

		const statusIcon =
			task.status === 'completed'
				? '✓'
				: task.status === 'in_progress'
					? '◐'
					: '○';
		results.push(`  ${statusIcon} [${task.id}] ${task.title}`);
	}

	await saveTasks(tasks);

	const counts = {
		pending: tasks.filter(t => t.status === 'pending').length,
		in_progress: tasks.filter(t => t.status === 'in_progress').length,
		completed: tasks.filter(t => t.status === 'completed').length,
	};

	const allTasksList = tasks
		.map(t => {
			const icon =
				t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○';
			return `  ${icon} [${t.id}] ${t.title}`;
		})
		.join('\n');

	return `Updated ${args.updates.length} task(s):\n${results.join('\n')}\n\nAll Tasks (${counts.pending} pending, ${counts.in_progress} in progress, ${counts.completed} completed):\n${allTasksList}`;
};

const updateTaskCoreTool = tool({
	description:
		'Update one or more tasks. Use this to mark tasks as in_progress when starting work, or completed when finished. Pass an array of updates.',
	inputSchema: jsonSchema<UpdateTaskArgs>({
		type: 'object',
		properties: {
			updates: {
				type: 'array',
				description: 'Array of task updates',
				items: {
					type: 'object',
					properties: {
						id: {
							type: 'string',
							description: 'The ID of the task to update',
						},
						status: {
							type: 'string',
							enum: ['pending', 'in_progress', 'completed'],
							description: 'New status for the task',
						},
						title: {
							type: 'string',
							description: 'New title for the task',
						},
						description: {
							type: 'string',
							description: 'New description for the task',
						},
					},
					required: ['id'],
				},
			},
		},
		required: ['updates'],
	}),
	needsApproval: false,
	execute: async (args, _options) => {
		return await executeUpdateTask(args);
	},
});

const updateTaskFormatter = async (
	_args: UpdateTaskArgs,
	_result?: string,
): Promise<React.ReactElement> => {
	const allTasks = await loadTasks();
	return <TaskListDisplay tasks={allTasks} title="Tasks" />;
};

const updateTaskValidator = async (
	args: UpdateTaskArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	if (!args.updates || args.updates.length === 0) {
		return {
			valid: false,
			error: '⚒ At least one update is required',
		};
	}

	for (let i = 0; i < args.updates.length; i++) {
		const update = args.updates[i];

		if (!update?.id?.trim()) {
			return {
				valid: false,
				error: `⚒ Update ${i + 1}: Task ID is required`,
			};
		}

		if (
			update.status === undefined &&
			update.title === undefined &&
			update.description === undefined
		) {
			return {
				valid: false,
				error: `⚒ Update ${i + 1}: At least one field (status, title, or description) must be provided`,
			};
		}

		if (update.title !== undefined && update.title.trim().length === 0) {
			return {
				valid: false,
				error: `⚒ Update ${i + 1}: Task title cannot be empty`,
			};
		}

		if (update.title !== undefined && update.title.length > 200) {
			return {
				valid: false,
				error: `⚒ Update ${i + 1}: Task title is too long (max 200 characters)`,
			};
		}
	}

	return {valid: true};
};

export const updateTaskTool: NanocoderToolExport = {
	name: 'update_task' as const,
	tool: updateTaskCoreTool,
	formatter: updateTaskFormatter,
	validator: updateTaskValidator,
};
