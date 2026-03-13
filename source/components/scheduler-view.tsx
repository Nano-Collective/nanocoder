import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';
import {DevelopmentModeIndicator} from '@/components/development-mode-indicator';
import {useTheme} from '@/hooks/useTheme';
import type {DevelopmentMode} from '@/types/core';

interface SchedulerViewProps {
	activeJobCount: number;
	queueLength: number;
	isProcessing: boolean;
	currentJobCommand: string | null;
	developmentMode: DevelopmentMode;
	contextPercentUsed: number | null;
	onExit: () => void;
}

export const SchedulerView = React.memo(
	({
		activeJobCount,
		queueLength,
		isProcessing,
		currentJobCommand,
		developmentMode,
		contextPercentUsed,
		onExit,
	}: SchedulerViewProps) => {
		const {colors} = useTheme();

		useInput((_input, key) => {
			if (key.escape) {
				onExit();
			}
		});

		return (
			<Box flexDirection="column">
				<DevelopmentModeIndicator
					developmentMode={developmentMode}
					colors={colors}
					contextPercentUsed={contextPercentUsed}
				/>
				<Box marginTop={1}>
					<Text color={colors.info}>
						<Spinner type="dots" />
					</Text>
					<Text color={colors.secondary}>
						{' '}
						— {activeJobCount} cron job{activeJobCount !== 1 ? 's' : ''}{' '}
						registered
					</Text>
				</Box>
				{isProcessing && currentJobCommand && (
					<Box marginTop={1}>
						<Text color={colors.primary}>Running: {currentJobCommand}</Text>
						{queueLength > 0 && (
							<Text color={colors.secondary}> ({queueLength} queued)</Text>
						)}
					</Box>
				)}
				{!isProcessing && (
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Waiting for next scheduled job...
						</Text>
					</Box>
				)}
				<Box marginTop={1}>
					<Text dimColor>Press Escape to exit scheduler mode</Text>
				</Box>
			</Box>
		);
	},
);

SchedulerView.displayName = 'SchedulerView';
