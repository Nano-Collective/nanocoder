import React from 'react';

import {TaskListDisplay} from '@/components/task-list-display';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {clearAllTasks, loadTasks, saveTasks} from './storage';

interface DeleteTaskArgs {
	ids?: string[];
	clear_all?: boolean;
}

const executeDeleteTask = async (args: DeleteTaskArgs): Promise<string> => {
	if (args.clear_all) {
		const tasks = await loadTasks();
		const count = tasks.length;
		await clearAllTasks();
		return `Cleared all ${count} task(s)\n\nNo tasks remaining.`;
	}

	if (!args.ids || args.ids.length === 0) {
		throw new Error('Either ids or clear_all must be provided');
	}

	const tasks = await loadTasks();
	const results: string[] = [];
	const idsToDelete = new Set(args.ids);

	const remainingTasks = tasks.filter(t => {
		if (idsToDelete.has(t.id)) {
			results.push(`  ✗ [${t.id}] ${t.title}`);
			return false;
		}
		return true;
	});

	// Check for IDs that weren't found
	const foundIds = new Set(tasks.map(t => t.id));
	for (const id of args.ids) {
		if (!foundIds.has(id)) {
			results.push(`  ? Task not found: ${id}`);
		}
	}

	await saveTasks(remainingTasks);

	const counts = {
		pending: remainingTasks.filter(t => t.status === 'pending').length,
		in_progress: remainingTasks.filter(t => t.status === 'in_progress').length,
		completed: remainingTasks.filter(t => t.status === 'completed').length,
	};

	if (remainingTasks.length === 0) {
		return `Deleted ${args.ids.length} task(s):\n${results.join('\n')}\n\nNo tasks remaining.`;
	}

	const allTasksList = remainingTasks
		.map(t => {
			const icon =
				t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○';
			return `  ${icon} [${t.id}] ${t.title}`;
		})
		.join('\n');

	return `Deleted ${args.ids.length} task(s):\n${results.join('\n')}\n\nRemaining Tasks (${counts.pending} pending, ${counts.in_progress} in progress, ${counts.completed} completed):\n${allTasksList}`;
};

const deleteTaskCoreTool = tool({
	description:
		'Delete one or more tasks by ID, or clear all tasks. Pass an array of ids, or use clear_all to reset.',
	inputSchema: jsonSchema<DeleteTaskArgs>({
		type: 'object',
		properties: {
			ids: {
				type: 'array',
				description: 'Array of task IDs to delete',
				items: {
					type: 'string',
				},
			},
			clear_all: {
				type: 'boolean',
				description: 'Set to true to delete all tasks and reset the list',
			},
		},
		required: [],
	}),
	needsApproval: false,
	execute: async (args, _options) => {
		return await executeDeleteTask(args);
	},
});

const deleteTaskFormatter = async (
	args: DeleteTaskArgs,
	_result?: string,
): Promise<React.ReactElement> => {
	const allTasks = await loadTasks();
	const title = args.clear_all ? 'Tasks Cleared' : 'Tasks';
	return <TaskListDisplay tasks={allTasks} title={title} />;
};

const deleteTaskValidator = (
	args: DeleteTaskArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const hasIds = args.ids && args.ids.length > 0;
	const hasClearAll = args.clear_all === true;

	if (!hasIds && !hasClearAll) {
		return Promise.resolve({
			valid: false,
			error: '⚒ Either ids (array) or clear_all must be provided',
		});
	}

	if (hasIds && hasClearAll) {
		return Promise.resolve({
			valid: false,
			error: '⚒ Cannot specify both ids and clear_all',
		});
	}

	return Promise.resolve({valid: true});
};

export const deleteTaskTool: NanocoderToolExport = {
	name: 'delete_task' as const,
	tool: deleteTaskCoreTool,
	formatter: deleteTaskFormatter,
	validator: deleteTaskValidator,
};
