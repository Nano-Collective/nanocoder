import {Box, Text} from 'ink';
import React from 'react';
import {TaskListDisplay} from '@/components/task-list-display';
import {useTheme} from '@/hooks/useTheme';
import {
	clearAllTasks,
	generateTaskId,
	loadTasks,
	saveTasks,
} from '@/tools/tasks/storage';
import type {Task} from '@/tools/tasks/types';
import type {Command} from '@/types/index';

function TaskMessage({message, isError}: {message: string; isError?: boolean}) {
	const {colors} = useTheme();
	return (
		<Box marginY={1}>
			<Text color={isError ? colors.error : colors.success}>{message}</Text>
		</Box>
	);
}

interface TasksDisplayProps {
	tasks: Task[];
	message?: string;
	isError?: boolean;
}

function TasksDisplay({tasks, message, isError}: TasksDisplayProps) {
	return (
		<Box flexDirection="column">
			{message && <TaskMessage message={message} isError={isError} />}
			<TaskListDisplay tasks={tasks} title="Tasks" />
		</Box>
	);
}

export const tasksCommand: Command = {
	name: 'tasks',
	description: 'Manage your task list',
	handler: async (args: string[]) => {
		const subcommand = args[0]?.toLowerCase();
		const rest = args.slice(1).join(' ');

		// No subcommand - show task list
		if (!subcommand) {
			const tasks = await loadTasks();
			return React.createElement(TasksDisplay, {
				key: `tasks-list-${Date.now()}`,
				tasks,
			});
		}

		// Add task
		if (subcommand === 'add') {
			if (!rest.trim()) {
				return React.createElement(TaskMessage, {
					key: `tasks-error-${Date.now()}`,
					message: 'Usage: /tasks add <title>',
					isError: true,
				});
			}

			const tasks = await loadTasks();
			const now = new Date().toISOString();
			const newTask: Task = {
				id: generateTaskId(),
				title: rest.trim(),
				status: 'pending',
				createdAt: now,
				updatedAt: now,
			};
			tasks.push(newTask);
			await saveTasks(tasks);

			return React.createElement(TasksDisplay, {
				key: `tasks-added-${Date.now()}`,
				tasks,
				message: `Added: ${newTask.title}`,
			});
		}

		// Remove task
		if (subcommand === 'remove' || subcommand === 'rm') {
			if (!rest.trim()) {
				return React.createElement(TaskMessage, {
					key: `tasks-error-${Date.now()}`,
					message: 'Usage: /tasks remove <number>',
					isError: true,
				});
			}

			const taskNumber = parseInt(rest.trim(), 10);
			if (isNaN(taskNumber) || taskNumber < 1) {
				return React.createElement(TaskMessage, {
					key: `tasks-error-${Date.now()}`,
					message: 'Please provide a valid task number (e.g., /tasks remove 1)',
					isError: true,
				});
			}

			const tasks = await loadTasks();
			const taskIndex = taskNumber - 1;

			if (taskIndex >= tasks.length) {
				return React.createElement(TaskMessage, {
					key: `tasks-error-${Date.now()}`,
					message: `Task ${taskNumber} not found. You have ${tasks.length} task(s).`,
					isError: true,
				});
			}

			const removed = tasks.splice(taskIndex, 1)[0];
			await saveTasks(tasks);

			return React.createElement(TasksDisplay, {
				key: `tasks-removed-${Date.now()}`,
				tasks,
				message: `Removed: ${removed.title}`,
			});
		}

		// Clear all
		if (subcommand === 'clear') {
			await clearAllTasks();
			return React.createElement(TasksDisplay, {
				key: `tasks-cleared-${Date.now()}`,
				tasks: [],
				message: 'All tasks cleared',
			});
		}

		// Unknown subcommand - treat as task title to add
		const fullTitle = args.join(' ').trim();
		const tasks = await loadTasks();
		const now = new Date().toISOString();
		const newTask: Task = {
			id: generateTaskId(),
			title: fullTitle,
			status: 'pending',
			createdAt: now,
			updatedAt: now,
		};
		tasks.push(newTask);
		await saveTasks(tasks);

		return React.createElement(TasksDisplay, {
			key: `tasks-added-${Date.now()}`,
			tasks,
			message: `Added: ${newTask.title}`,
		});
	},
};
