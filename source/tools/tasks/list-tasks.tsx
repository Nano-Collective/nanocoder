import React from 'react';

import {TaskListDisplay} from '@/components/task-list-display';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {loadTasks} from './storage';
import type {Task, TaskStatus} from './types';

interface ListTasksArgs {
	status?: TaskStatus | 'all';
}

const executeListTasks = async (args: ListTasksArgs): Promise<string> => {
	const tasks = await loadTasks();
	const statusFilter = args.status || 'all';

	const filteredTasks =
		statusFilter === 'all'
			? tasks
			: tasks.filter(t => t.status === statusFilter);

	if (filteredTasks.length === 0) {
		if (statusFilter === 'all') {
			return 'No tasks found. Create one with create_task.';
		}
		return `No tasks with status "${statusFilter}" found.`;
	}

	// Format tasks for LLM context
	const lines = filteredTasks.map(task => {
		const statusIcon =
			task.status === 'completed'
				? '✓'
				: task.status === 'in_progress'
					? '◐'
					: '○';
		const desc = task.description ? ` - ${task.description}` : '';
		return `${statusIcon} [${task.id}] ${task.title}${desc}`;
	});

	const counts = {
		pending: tasks.filter(t => t.status === 'pending').length,
		in_progress: tasks.filter(t => t.status === 'in_progress').length,
		completed: tasks.filter(t => t.status === 'completed').length,
	};

	const header = `Tasks (${counts.pending} pending, ${counts.in_progress} in progress, ${counts.completed} completed)`;

	return `${header}\n${'─'.repeat(50)}\n${lines.join('\n')}`;
};

const listTasksCoreTool = tool({
	description:
		'List all tasks with optional status filtering. Use this to see current progress and what work remains.',
	inputSchema: jsonSchema<ListTasksArgs>({
		type: 'object',
		properties: {
			status: {
				type: 'string',
				enum: ['pending', 'in_progress', 'completed', 'all'],
				description:
					'Filter tasks by status. Default is "all" to show all tasks.',
			},
		},
		required: [],
	}),
	needsApproval: false,
	execute: async (args, _options) => {
		return await executeListTasks(args);
	},
});

const listTasksFormatter = async (
	args: ListTasksArgs,
	_result?: string,
): Promise<React.ReactElement> => {
	const tasks = await loadTasks();
	const statusFilter = args.status || 'all';

	const filteredTasks: Task[] =
		statusFilter === 'all'
			? tasks
			: tasks.filter(t => t.status === statusFilter);

	const title =
		statusFilter === 'all' ? 'Tasks' : `Tasks (${statusFilter} only)`;

	return <TaskListDisplay tasks={filteredTasks} title={title} />;
};

export const listTasksTool: NanocoderToolExport = {
	name: 'list_tasks' as const,
	tool: listTasksCoreTool,
	formatter: listTasksFormatter,
};
