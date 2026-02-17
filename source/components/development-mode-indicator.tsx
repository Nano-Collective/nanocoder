import {Box, Text} from 'ink';
import React from 'react';
import {
	TOKEN_THRESHOLD_CRITICAL_PERCENT,
	TOKEN_THRESHOLD_WARNING_PERCENT,
} from '@/constants';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import type {useTheme} from '@/hooks/useTheme';
import type {DevelopmentMode} from '@/types/core';
import {
	DEVELOPMENT_MODE_LABELS,
	DEVELOPMENT_MODE_LABELS_NARROW,
} from '@/types/core';

interface DevelopmentModeIndicatorProps {
	developmentMode: DevelopmentMode;
	colors: ReturnType<typeof useTheme>['colors'];
	contextPercentUsed: number | null;
}

function getContextColor(
	percent: number,
	colors: ReturnType<typeof useTheme>['colors'],
): string {
	if (percent >= TOKEN_THRESHOLD_CRITICAL_PERCENT) return colors.error;
	if (percent >= TOKEN_THRESHOLD_WARNING_PERCENT) return colors.warning;
	return colors.secondary;
}

/**
 * Development mode indicator component
 * Shows the current development mode (normal/auto-accept/plan) and instructions
 * Always visible to help users understand the current mode
 */
export const DevelopmentModeIndicator = React.memo(
	({
		developmentMode,
		colors,
		contextPercentUsed,
	}: DevelopmentModeIndicatorProps) => {
		const {isNarrow} = useResponsiveTerminal();
		const modeLabel = isNarrow
			? DEVELOPMENT_MODE_LABELS_NARROW[developmentMode]
			: DEVELOPMENT_MODE_LABELS[developmentMode];

		return (
			<Box marginTop={1}>
				<Text
					color={
						developmentMode === 'normal'
							? colors.secondary
							: developmentMode === 'auto-accept'
								? colors.info
								: colors.warning
					}
				>
					<Text bold>{modeLabel}</Text>
					{isNarrow && <Text dimColor> (Shift+Tab to cycle)</Text>}
				</Text>
				{contextPercentUsed !== null && (
					<>
						<Text color={colors.secondary}>· </Text>
						<Text
							color={getContextColor(contextPercentUsed, colors)}
							dimColor={contextPercentUsed < TOKEN_THRESHOLD_WARNING_PERCENT}
						>
							ctx: {contextPercentUsed}%
						</Text>
					</>
				)}
			</Box>
		);
	},
);

DevelopmentModeIndicator.displayName = 'DevelopmentModeIndicator';
