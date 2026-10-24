import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useTheme} from '@/hooks/useTheme';
import type {ToolExecutionIndicatorProps} from '@/types/index';

export default function ToolExecutionIndicator({
	toolName,
	currentIndex,
	totalTools,
}: ToolExecutionIndicatorProps) {
	const {colors} = useTheme();
	return (
		<Box marginBottom={1} marginLeft={2}>
			<Spinner type="dots" />
			<Text color={colors.tool}> {toolName}</Text>
			{totalTools > 1 && (
				<Text color={colors.secondary}>
					{' '}
					{currentIndex + 1}/{totalTools}
				</Text>
			)}
			<Text color={colors.secondary}> · Press Esc to cancel</Text>
		</Box>
	);
}
