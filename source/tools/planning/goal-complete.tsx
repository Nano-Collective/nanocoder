/**
 * Goal Complete Tool
 *
 * Signals that the overall goal has been achieved.
 */

import React from 'react';
import {Box, Text} from 'ink';
import {tool, jsonSchema} from '@/types/core';
import type {NanocoderToolExport} from '@/types/core';
import {ThemeContext} from '@/hooks/useTheme';
import ToolMessage from '@/components/tool-message';
import * as todoStore from './todo-store';

const goalCompleteCoreTool = tool({
	description:
		'Mark the goal as complete. Call this when you have fully answered the user\'s question or completed their request. Include a brief summary of what was accomplished.',
	inputSchema: jsonSchema<{
		summary: string;
	}>({
		type: 'object',
		properties: {
			summary: {
				type: 'string',
				description: 'Brief summary of what was accomplished and how the goal was achieved',
			},
		},
		required: ['summary'],
	}),
	needsApproval: false,
	execute: async (args) => {
		todoStore.completeGoal(args.summary);
		return `Goal marked complete: ${args.summary}`;
	},
});

/**
 * Status icon helper
 */
function getStatusIcon(status: todoStore.TodoStatus): string {
	switch (status) {
		case 'pending':
			return '○';
		case 'in_progress':
			return '●';
		case 'completed':
			return '✓';
		case 'failed':
			return '✗';
	}
}

/**
 * Formatter showing goal completion with final summary
 */
const GoalCompleteFormatter = React.memo(({summary}: {summary: string}) => {
	const themeContext = React.useContext(ThemeContext);
	if (!themeContext) {
		throw new Error('GoalCompleteFormatter must be used within a ThemeProvider');
	}
	const {colors} = themeContext;

	const state = todoStore.getState();
	const stats = todoStore.getStats();

	const getStatusColor = (status: todoStore.TodoStatus) => {
		switch (status) {
			case 'pending':
				return colors.secondary;
			case 'in_progress':
				return colors.warning;
			case 'completed':
				return colors.success;
			case 'failed':
				return colors.error;
		}
	};

	return (
		<ToolMessage
			message={
				<Box flexDirection="column">
					<Text color={colors.success} bold>
						✓ Goal Complete
					</Text>

					{state.goal && (
						<Box marginTop={1}>
							<Text color={colors.secondary}>Goal: </Text>
							<Text color={colors.white}>{state.goal}</Text>
						</Box>
					)}

					{state.todos.length > 0 && (
						<Box flexDirection="column" marginTop={1}>
							{state.todos.map((todo) => {
								const statusColor = getStatusColor(todo.status);
								const icon = getStatusIcon(todo.status);

								return (
									<Box key={todo.id}>
										<Text color={statusColor}>{icon} </Text>
										<Text color={colors.secondary}>{todo.title}</Text>
									</Box>
								);
							})}
						</Box>
					)}

					<Box marginTop={1}>
						<Text color={colors.secondary}>Summary: </Text>
						<Text color={colors.white}>{summary}</Text>
					</Box>

					{stats.total > 0 && (
						<Box marginTop={1}>
							<Text color={colors.success}>
								Completed {stats.completed}/{stats.total} tasks
							</Text>
						</Box>
					)}
				</Box>
			}
			hideBox={true}
		/>
	);
});

const goalCompleteFormatter = async (
	args: {summary: string},
	_result?: string,
): Promise<React.ReactElement> => {
	return <GoalCompleteFormatter summary={args.summary} />;
};

export const goalCompleteTool: NanocoderToolExport = {
	name: 'goal_complete',
	tool: goalCompleteCoreTool,
	formatter: goalCompleteFormatter,
};
