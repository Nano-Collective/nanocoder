import React from 'react';
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
		<Box flexDirection="column" marginBottom={1}>
			<Box>
				<Spinner type="dots" />
				<Text color={colors.tool}> Executing tool: </Text>
				<Text color={colors.primary}>{toolName}</Text>
			</Box>

			{totalTools > 1 && (
				<Box marginTop={1}>
					<Text color={colors.secondary}>
						Tool {currentIndex + 1} of {totalTools}
					</Text>
				</Box>
			)}

			<Box marginTop={1}>
				<Text color={colors.secondary}>Press Escape to cancel</Text>
			</Box>
		</Box>
	);
}
