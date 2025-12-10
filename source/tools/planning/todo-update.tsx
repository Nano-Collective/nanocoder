/**
 * Todo Update Tool
 *
 * Allows the model to update task status (start, complete, fail).
 */

import React from 'react';
import {Box, Text} from 'ink';
import {tool, jsonSchema} from '@/types/core';
import type {NanocoderToolExport} from '@/types/core';
import {ThemeContext} from '@/hooks/useTheme';
import ToolMessage from '@/components/tool-message';
import * as todoStore from './todo-store';
import type {TodoStatus} from './todo-store';

const todoUpdateCoreTool = tool({
	description:
		'Update a task status. Use "in_progress" when starting work on a task, "completed" when done, or "failed" if it cannot be completed.',
	inputSchema: jsonSchema<{
		id: string;
		status: TodoStatus;
	}>({
		type: 'object',
		properties: {
			id: {
				type: 'string',
				description: 'The task ID to update',
			},
			status: {
				type: 'string',
				enum: ['in_progress', 'completed', 'failed'],
				description: 'New status: "in_progress" (starting), "completed" (done), or "failed" (cannot complete)',
			},
		},
		required: ['id', 'status'],
	}),
	needsApproval: false,
	execute: async (args) => {
		let todo;
		if (args.status === 'in_progress') {
			todo = todoStore.startTodo(args.id);
		} else {
			todo = todoStore.updateTodo(args.id, args.status);
		}

		if (!todo) {
			return `Error: Task with id "${args.id}" not found`;
		}

		return `Updated task "${todo.title}" to ${args.status}`;
	},
});

/**
 * Status icon helper
 */
function getStatusIcon(status: TodoStatus): string {
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
 * Formatter component showing the updated todo list
 */
const TodoUpdateFormatter = React.memo(
	({updatedId, newStatus}: {updatedId: string; newStatus: TodoStatus}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('TodoUpdateFormatter must be used within a ThemeProvider');
		}
		const {colors} = themeContext;

		const state = todoStore.getState();
		const stats = todoStore.getStats();

		// Color based on status
		const getStatusColor = (status: TodoStatus) => {
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
						<Text color={colors.tool}>📋 Progress</Text>

						{state.goal && (
							<Box marginTop={1}>
								<Text color={colors.secondary}>Goal: </Text>
								<Text color={colors.white}>{state.goal}</Text>
							</Box>
						)}

						<Box flexDirection="column" marginTop={1}>
							{state.todos.map((todo) => {
								const isUpdated = todo.id === updatedId;
								const statusColor = getStatusColor(todo.status);
								const icon = getStatusIcon(todo.status);

								return (
									<Box key={todo.id}>
										<Text color={statusColor}>{icon} </Text>
										<Text
											color={isUpdated ? colors.white : colors.secondary}
											bold={isUpdated}
										>
											{todo.title}
										</Text>
										{isUpdated && (
											<Text color={statusColor}> ← {newStatus}</Text>
										)}
									</Box>
								);
							})}
						</Box>

						<Box marginTop={1}>
							<Text color={colors.secondary}>
								Progress: {stats.completed}/{stats.total}
								{stats.total > 0 &&
									` (${Math.round((stats.completed / stats.total) * 100)}%)`}
							</Text>
						</Box>
					</Box>
				}
				hideBox={true}
			/>
		);
	},
);

const todoUpdateFormatter = async (
	args: {id: string; status: TodoStatus},
	_result?: string,
): Promise<React.ReactElement> => {
	return <TodoUpdateFormatter updatedId={args.id} newStatus={args.status} />;
};

export const todoUpdateTool: NanocoderToolExport = {
	name: 'todo_update',
	tool: todoUpdateCoreTool,
	formatter: todoUpdateFormatter,
};
