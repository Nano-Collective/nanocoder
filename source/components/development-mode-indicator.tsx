import {Box, Text} from 'ink';
import React from 'react';
import {
	TOKEN_THRESHOLD_CRITICAL_PERCENT,
	TOKEN_THRESHOLD_WARNING_PERCENT,
} from '@/constants';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import type {useTheme} from '@/hooks/useTheme';
import type {TuneConfig} from '@/types/config';
import type {DevelopmentMode} from '@/types/core';
import {
	DEVELOPMENT_MODE_LABELS,
	DEVELOPMENT_MODE_LABELS_NARROW,
} from '@/types/core';
import type {ActiveEditorState} from '@/vscode/vscode-server';

interface DevelopmentModeIndicatorProps {
	developmentMode: DevelopmentMode;
	colors: ReturnType<typeof useTheme>['colors'];
	contextPercentUsed: number | null;
	tune?: TuneConfig;
	activeEditor?: ActiveEditorState | null;
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
 * Shows the current development mode (normal/auto-accept/plan/scheduler) and instructions
 * Always visible to help users understand the current mode
 */
export const DevelopmentModeIndicator = React.memo(
	({
		developmentMode,
		colors,
		contextPercentUsed,
		tune,
		activeEditor,
	}: DevelopmentModeIndicatorProps) => {
		const {isNarrow, actualWidth, truncate} = useResponsiveTerminal();
		const modeLabel = isNarrow
			? DEVELOPMENT_MODE_LABELS_NARROW[developmentMode]
			: DEVELOPMENT_MODE_LABELS[developmentMode];

		const tuneLabel = tune?.enabled
			? isNarrow
				? 'tune: ✓'
				: 'tune: enabled'
			: '';

		// Truncate the filename so the whole indicator line stays within one
		// terminal row — the other segments (mode, tune, ctx, prefix, suffix)
		// keep their budget and we shrink just the filename with an ellipsis.
		const editorLabel = (() => {
			if (!activeEditor?.fileName) return null;
			const hasSelection =
				!!activeEditor.selection &&
				!!activeEditor.startLine &&
				!!activeEditor.endLine;
			const prefix = hasSelection ? '⊡ ' : '⊡ In ';
			const suffix = hasSelection
				? ` (L${activeEditor.startLine}-${activeEditor.endLine})`
				: '';

			const shiftHint =
				isNarrow && developmentMode !== 'scheduler'
					? ' (Shift+Tab to cycle)'
					: '';
			const tuneSegment = tuneLabel ? ` · ${tuneLabel}` : '';
			const ctxSegment =
				contextPercentUsed !== null ? ` · ctx: ${contextPercentUsed}%` : '';

			const usedWidth =
				modeLabel.length +
				shiftHint.length +
				tuneSegment.length +
				ctxSegment.length +
				` · ${prefix}`.length +
				suffix.length;

			const minFilenameLen = 8;
			const maxFilenameLen = Math.max(
				minFilenameLen,
				actualWidth - usedWidth - 1,
			);
			const filename = truncate(activeEditor.fileName, maxFilenameLen);

			return `${prefix}${filename}${suffix}`;
		})();

		return (
			<Box marginTop={1}>
				<Text
					color={
						developmentMode === 'normal'
							? colors.secondary
							: developmentMode === 'yolo'
								? colors.error
								: developmentMode === 'auto-accept' ||
										developmentMode === 'scheduler'
									? colors.info
									: colors.warning
					}
				>
					<Text bold>{modeLabel}</Text>
					{isNarrow && developmentMode !== 'scheduler' && (
						<Text> (Shift+Tab to cycle)</Text>
					)}
				</Text>
				{tuneLabel && (
					<>
						<Text color={colors.secondary}> · </Text>
						<Text color={colors.info}>{tuneLabel}</Text>
					</>
				)}
				{contextPercentUsed !== null && (
					<>
						<Text color={colors.secondary}> · </Text>
						<Text color={getContextColor(contextPercentUsed, colors)}>
							ctx: {contextPercentUsed}%
						</Text>
					</>
				)}
				{editorLabel && (
					<>
						<Text color={colors.secondary}> · </Text>
						<Text color={colors.info}>{editorLabel}</Text>
					</>
				)}
			</Box>
		);
	},
);

DevelopmentModeIndicator.displayName = 'DevelopmentModeIndicator';
