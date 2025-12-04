/**
 * Task Plan View
 *
 * Simple bullet-point display of plan progress.
 * Read-only - shows task status without user interaction.
 */

import React from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '@/hooks/useTheme';
import type {Task, TaskPlan} from '@/agent/types';

interface TaskPlanViewProps {
	plan: TaskPlan;
}

/**
 * Get the status indicator for a task
 */
function getStatusIndicator(status: Task['status']): {
	symbol: string;
	color: string;
} {
	switch (status) {
		case 'completed':
			return {symbol: '✓', color: 'success'};
		case 'in_progress':
			return {symbol: '●', color: 'warning'};
		case 'failed':
			return {symbol: '✗', color: 'error'};
		case 'blocked':
			return {symbol: '⊘', color: 'gray'};
		case 'skipped':
			return {symbol: '○', color: 'gray'};
		case 'pending':
		default:
			return {symbol: '○', color: 'gray'};
	}
}

/**
 * Single task row in the plan view
 */
function TaskRow({
	task,
	colors,
}: {
	task: Task;
	colors: ReturnType<typeof useTheme>['colors'];
}) {
	const {symbol, color} = getStatusIndicator(task.status);

	return (
		<Box>
			<Text color={color}>{symbol} </Text>
			<Text
				color={task.status === 'in_progress' ? colors.primary : undefined}
				bold={task.status === 'in_progress'}
				dimColor={task.status === 'skipped' || task.status === 'blocked'}
			>
				{task.title}
			</Text>
			{task.status === 'failed' && task.result?.error && (
				<Text color={colors.error}> ({task.result.error.slice(0, 30)}...)</Text>
			)}
		</Box>
	);
}

/**
 * Task Plan View Component
 */
export default function TaskPlanView({plan}: TaskPlanViewProps) {
	const {colors} = useTheme();

	// Get tasks in execution order
	const orderedTasks = plan.executionOrder
		.map(id => plan.tasks.find(t => t.id === id))
		.filter((t): t is Task => t !== undefined);

	// Calculate progress
	const completed = plan.tasks.filter(t => t.status === 'completed').length;
	const total = plan.tasks.length;
	const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

	return (
		<Box flexDirection="column" marginBottom={1}>
			{/* Header */}
			<Box marginBottom={1}>
				<Text color={colors.primary} bold>
					Goal:{' '}
				</Text>
				<Text>{plan.originalGoal}</Text>
			</Box>

			{/* Task list */}
			<Box flexDirection="column">
				{orderedTasks.map(task => (
					<TaskRow key={task.id} task={task} colors={colors} />
				))}
			</Box>

			{/* Progress footer */}
			<Box marginTop={1}>
				<Text dimColor>
					Progress: {completed}/{total} ({percentComplete}%)
				</Text>
			</Box>
		</Box>
	);
}
