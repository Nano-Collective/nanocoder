import {Box, Text} from 'ink';
import {useTheme} from '@/hooks/useTheme';
import type {Task} from '@/tools/tasks/types';

interface TaskListDisplayProps {
	tasks: Task[];
	title?: string;
}

const STATUS_ICONS: Record<Task['status'], string> = {
	pending: '○',
	in_progress: '◐',
	completed: '✓',
};

export function TaskListDisplay({
	tasks,
	title = 'Tasks',
}: TaskListDisplayProps) {
	const {colors} = useTheme();

	if (tasks.length === 0) {
		return (
			<Box flexDirection="column" marginY={1}>
				<Text color={colors.secondary}>
					No tasks found. Create one with create_task.
				</Text>
			</Box>
		);
	}

	const getStatusColor = (status: Task['status']): string => {
		switch (status) {
			case 'completed':
				return colors.success;
			case 'in_progress':
				return colors.warning;
			default:
				return colors.secondary;
		}
	};

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box flexDirection="column">
				<Box>
					<Text bold color={colors.primary}>
						{title}
					</Text>
				</Box>
				<Box flexDirection="column">
					{/* Task rows */}
					{tasks.map((task, index) => (
						<Box key={task.id} flexDirection="row">
							<Box width={2}>
								<Text color={getStatusColor(task.status)}>
									{STATUS_ICONS[task.status]}
								</Text>
							</Box>
							<Box width={3}>
								<Text color={colors.secondary}>{index + 1}.</Text>
							</Box>
							<Box>
								<Text
									color={
										task.status === 'completed' ? colors.secondary : colors.text
									}
								>
									{task.title}
								</Text>
							</Box>
						</Box>
					))}
				</Box>
			</Box>
		</Box>
	);
}
