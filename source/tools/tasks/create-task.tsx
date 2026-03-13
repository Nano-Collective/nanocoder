import React from 'react';

import {TaskListDisplay} from '@/components/task-list-display';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {generateTaskId, loadTasks, saveTasks} from './storage';
import type {Task} from './types';

interface TaskInput {
	title: string;
	description?: string;
}

interface CreateTaskArgs {
	tasks: TaskInput[];
}

const executeCreateTask = async (args: CreateTaskArgs): Promise<string> => {
	const existingTasks = await loadTasks();
	const now = new Date().toISOString();

	const newTasks: Task[] = args.tasks.map(input => ({
		id: generateTaskId(),
		title: input.title,
		description: input.description,
		status: 'pending' as const,
		createdAt: now,
		updatedAt: now,
	}));

	const allTasks = [...existingTasks, ...newTasks];
	await saveTasks(allTasks);

	// Return formatted task list for LLM context
	const createdList = newTasks.map(t => `  ○ [${t.id}] ${t.title}`).join('\n');

	const counts = {
		pending: allTasks.filter(t => t.status === 'pending').length,
		in_progress: allTasks.filter(t => t.status === 'in_progress').length,
		completed: allTasks.filter(t => t.status === 'completed').length,
	};

	const allTasksList = allTasks
		.map(t => {
			const icon =
				t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○';
			return `  ${icon} [${t.id}] ${t.title}`;
		})
		.join('\n');

	return `Created ${newTasks.length} task(s):\n${createdList}\n\nAll Tasks (${counts.pending} pending, ${counts.in_progress} in progress, ${counts.completed} completed):\n${allTasksList}`;
};

const createTaskCoreTool = tool({
	description:
		'Create one or more tasks to track work. Use this to plan and track progress on multi-step operations. Pass an array of tasks to create multiple at once.',
	inputSchema: jsonSchema<CreateTaskArgs>({
		type: 'object',
		properties: {
			tasks: {
				type: 'array',
				description: 'Array of tasks to create',
				items: {
					type: 'object',
					properties: {
						title: {
							type: 'string',
							description: 'The title of the task',
						},
						description: {
							type: 'string',
							description: 'Optional detailed description of the task',
						},
					},
					required: ['title'],
				},
			},
		},
		required: ['tasks'],
	}),
	needsApproval: false,
	execute: async (args, _options) => {
		return await executeCreateTask(args);
	},
});

const createTaskFormatter = async (
	args: CreateTaskArgs,
	_result?: string,
): Promise<React.ReactElement> => {
	const allTasks = await loadTasks();
	const taskCount = args.tasks?.length || 0;
	const title = `Created ${taskCount} task(s) - All Tasks`;

	return <TaskListDisplay tasks={allTasks} title={title} />;
};

const createTaskValidator = (
	args: CreateTaskArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	if (!args.tasks || args.tasks.length === 0) {
		return Promise.resolve({
			valid: false,
			error: '⚒ At least one task is required',
		});
	}

	for (let i = 0; i < args.tasks.length; i++) {
		const task = args.tasks[i];
		const title = task?.title?.trim();

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

export const createTaskTool: NanocoderToolExport = {
	name: 'create_task' as const,
	tool: createTaskCoreTool,
	formatter: createTaskFormatter,
	validator: createTaskValidator,
};
