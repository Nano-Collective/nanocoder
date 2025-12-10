/**
 * Todo Add Tool
 *
 * Allows the model to add tasks to its todo list during planning mode.
 */

import React from 'react';
import {Box, Text} from 'ink';
import {tool, jsonSchema} from '@/types/core';
import type {NanocoderToolExport} from '@/types/core';
import {ThemeContext} from '@/hooks/useTheme';
import ToolMessage from '@/components/tool-message';
import * as todoStore from './todo-store';

const todoAddCoreTool = tool({
	description:
		'Add a task to your todo list. Use this to plan out the steps needed to achieve the goal. Add tasks one at a time as you identify what needs to be done.',
	inputSchema: jsonSchema<{
		task: string;
	}>({
		type: 'object',
		properties: {
			task: {
				type: 'string',
				description: 'Brief description of the task (e.g., "Read the config file", "Find the login function")',
			},
		},
		required: ['task'],
	}),
	needsApproval: false,
	execute: async (args) => {
		const todo = todoStore.addTodo(args.task);
		return `Added task: "${args.task}" (id: ${todo.id})`;
	},
});

/**
 * Formatter component for todo_add
 */
const TodoAddFormatter = React.memo(
	({task, todoId}: {task: string; todoId: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('TodoAddFormatter must be used within a ThemeProvider');
		}
		const {colors} = themeContext;

		// Get current state to show the full list
		const state = todoStore.getState();
		const stats = todoStore.getStats();

		return (
			<ToolMessage
				message={
					<Box flexDirection="column">
						<Text color={colors.tool}>📋 todo_add</Text>
						<Box marginTop={1}>
							<Text color={colors.success}>+ </Text>
							<Text color={colors.white}>{task}</Text>
							<Text color={colors.secondary}> (#{todoId})</Text>
						</Box>

						{state.todos.length > 1 && (
							<Box marginTop={1}>
								<Text color={colors.secondary}>
									Tasks: {stats.completed}/{stats.total} complete
								</Text>
							</Box>
						)}
					</Box>
				}
				hideBox={true}
			/>
		);
	},
);

const todoAddFormatter = async (
	args: {task: string},
	result?: string,
): Promise<React.ReactElement> => {
	// Extract todo ID from result
	const idMatch = result?.match(/id: ([a-z0-9]+)/);
	const todoId = idMatch ? idMatch[1] : '?';

	return <TodoAddFormatter task={args.task} todoId={todoId} />;
};

export const todoAddTool: NanocoderToolExport = {
	name: 'todo_add',
	tool: todoAddCoreTool,
	formatter: todoAddFormatter,
};
