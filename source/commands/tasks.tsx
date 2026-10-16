import {Box, Text} from 'ink';
import React from 'react';
import {TaskListDisplay} from '@/components/task-list-display';
import {useTheme} from '@/hooks/useTheme';
import {generateKey} from '@/session/key-generator';
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

function taskNumberError(subcommand: string) {
	return React.createElement(TaskMessage, {
		key: generateKey('tasks-error'),
		message: `Usage: /tasks ${subcommand} <number>`,
		isError: true,
	});
}

function invalidTaskNumberError(subcommand: string) {
	return React.createElement(TaskMessage, {
		key: generateKey('tasks-error'),
		message: `Please provide a valid task number (e.g., /tasks ${subcommand} 1)`,
		isError: true,
	});
}

function taskNotFoundError(taskNumber: number, taskCount: number) {
	return React.createElement(TaskMessage, {
		key: generateKey('tasks-error'),
		message: `Task ${taskNumber} not found. You have ${taskCount} task(s).`,
		isError: true,
	});
}

function parseTaskNumber(value: string): number | null {
	const taskNumber = Number(value.trim());
	return Number.isInteger(taskNumber) && taskNumber >= 1 ? taskNumber : null;
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
				key: generateKey('tasks-list'),
				tasks,
			});
		}

		// Add task
		if (subcommand === 'add') {
			if (!rest.trim()) {
				return React.createElement(TaskMessage, {
					key: generateKey('tasks-error'),
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
				key: generateKey('tasks-added'),
				tasks,
				message: `Added: ${newTask.title}`,
			});
		}

		// Remove task
		if (subcommand === 'remove' || subcommand === 'rm') {
			if (!rest.trim()) return taskNumberError('remove');

			const taskNumber = parseTaskNumber(rest);
			if (taskNumber === null) {
				return invalidTaskNumberError('remove');
			}

			const tasks = await loadTasks();
			const taskIndex = taskNumber - 1;

			if (taskIndex >= tasks.length) {
				return taskNotFoundError(taskNumber, tasks.length);
			}

			const removed = tasks.splice(taskIndex, 1)[0];
			await saveTasks(tasks);

			return React.createElement(TasksDisplay, {
				key: generateKey('tasks-removed'),
				tasks,
				message: `Removed: ${removed.title}`,
			});
		}

		// Update task status
		if (
			subcommand === 'done' ||
			subcommand === 'complete' ||
			subcommand === 'start'
		) {
			if (!rest.trim()) return taskNumberError(subcommand);

			const taskNumber = parseTaskNumber(rest);
			if (taskNumber === null) {
				return invalidTaskNumberError(subcommand);
			}

			const tasks = await loadTasks();
			const taskIndex = taskNumber - 1;
			const task = tasks[taskIndex];
			if (!task) return taskNotFoundError(taskNumber, tasks.length);

			const now = new Date().toISOString();
			const status = subcommand === 'start' ? 'in_progress' : 'completed';
			task.status = status;
			task.updatedAt = now;
			if (status === 'completed') {
				task.completedAt = now;
			} else {
				delete task.completedAt;
			}
			await saveTasks(tasks);

			return React.createElement(TasksDisplay, {
				key: generateKey('tasks-updated'),
				tasks,
				message: `${status === 'completed' ? 'Completed' : 'Started'}: ${task.title}`,
			});
		}

		// Clear all
		if (subcommand === 'clear') {
			await clearAllTasks();
			return React.createElement(TasksDisplay, {
				key: generateKey('tasks-cleared'),
				tasks: [],
				message: 'All tasks cleared',
			});
		}

		// Explicit list subcommand
		if (subcommand === 'list') {
			const tasks = await loadTasks();
			return React.createElement(TasksDisplay, {
				key: generateKey('tasks-list'),
				tasks,
			});
		}

		// Unknown subcommand - show usage instead of silently adding a task.
		return React.createElement(TaskMessage, {
			key: generateKey('tasks-error'),
			message:
				'Unknown subcommand. Usage: /tasks [list|add <title>|remove <number>|done <number>|start <number>|clear]',
			isError: true,
		});
	},
};
