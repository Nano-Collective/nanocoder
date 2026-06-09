import {Box, Text} from 'ink';
import React from 'react';
import {
	TOKEN_THRESHOLD_CRITICAL_PERCENT,
	TOKEN_THRESHOLD_WARNING_PERCENT,
} from '@/constants';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import type {useTheme} from '@/hooks/useTheme';
import {resolveToolProfile} from '@/tools/tool-profiles';
import type {TuneConfig} from '@/types/config';
import type {ContextSource, DevelopmentMode} from '@/types/core';
import {
	DEVELOPMENT_MODE_LABELS,
	DEVELOPMENT_MODE_LABELS_NARROW,
} from '@/types/core';
import type {ActiveEditorState} from '@/vscode/vscode-server';

interface DevelopmentModeIndicatorProps {
	developmentMode: DevelopmentMode;
	colors: ReturnType<typeof useTheme>['colors'];
	contextPercentUsed: number | null;
	// Whether contextPercentUsed is API-reported ('api') or client-side
	// estimated ('estimate'/null). Estimated values render with a leading '~'.
	contextSource?: ContextSource | null;
	sessionName?: string;
	tune?: TuneConfig;
	currentModel?: string;
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
		contextSource,
		sessionName,
		tune,
		currentModel,
		activeEditor,
	}: DevelopmentModeIndicatorProps) => {
		const {isNarrow, actualWidth, truncate} = useResponsiveTerminal();
		const modeLabel = isNarrow
			? DEVELOPMENT_MODE_LABELS_NARROW[developmentMode]
			: DEVELOPMENT_MODE_LABELS[developmentMode];

		// Show the resolved profile (not the literal 'auto'), so users can see
		// what auto-profiling picked for the current model. Wide terminals also
		// flag the '(auto)' origin; narrow ones drop it to save space.
		const tuneLabel = (() => {
			if (!tune?.enabled) return '';
			const resolved = resolveToolProfile(tune.toolProfile, currentModel);
			if (isNarrow) return `tune: ${resolved}`;
			return tune.toolProfile === 'auto'
				? `tune: ${resolved} (auto)`
				: `tune: ${resolved}`;
		})();

		// Estimated context figures render with a leading '~' (≈); API-reported
		// figures render bare. The marker is a single char so it barely affects
		// the width budget below, where ctx never truncates.
		const ctxPrefix = contextSource === 'api' ? '' : '~';

		// Mode, tune, and ctx never truncate. Session name and the filename
		// portion of the editor pill share whatever room is left, each
		// truncating with an ellipsis; if both fit fully neither truncates;
		// if both overflow they split the remaining space evenly.
		// The line-range suffix and the (Shift+Tab to cycle) hint are
		// optional — drop them when otherwise the row would wrap. Suffix
		// drops first (line-range info is more contextual than help text),
		// then the shift hint.
		const {sessionLabel, editorLabel, showShiftHint} = (() => {
			const editorFileName = activeEditor?.fileName;
			const hasSelection =
				!!activeEditor?.selection &&
				!!activeEditor.startLine &&
				!!activeEditor.endLine;
			const editorPrefix = editorFileName
				? hasSelection
					? '⊡ '
					: '⊡ In '
				: '';
			const editorSuffixFull =
				editorFileName && hasSelection
					? ` (L${activeEditor.startLine}-${activeEditor.endLine})`
					: '';

			const shiftHintFull =
				isNarrow && developmentMode !== 'headless'
					? ' (Shift+Tab to cycle)'
					: '';
			const tuneSegment = tuneLabel ? ` · ${tuneLabel}` : '';
			const ctxSegment =
				contextPercentUsed !== null
					? ` · ctx: ${ctxPrefix}${contextPercentUsed}%`
					: '';
			const sessionSeparator = sessionName ? ' · ' : '';
			const editorSeparator = editorFileName ? ' · ' : '';

			const minLen = 6;
			const minSessionLen = sessionName ? minLen : 0;
			const minEditorLen = editorFileName ? minLen : 0;

			// Width consumed by parts that always render.
			const requiredWidth =
				modeLabel.length +
				tuneSegment.length +
				ctxSegment.length +
				sessionSeparator.length +
				editorSeparator.length +
				editorPrefix.length +
				minSessionLen +
				minEditorLen;

			// Decide which optional segments fit. Drop the suffix first, then
			// the shift hint, until the row fits within actualWidth.
			let editorSuffix = editorSuffixFull;
			let shiftHint = shiftHintFull;
			if (
				requiredWidth + editorSuffix.length + shiftHint.length + 1 >
				actualWidth
			) {
				editorSuffix = '';
				if (requiredWidth + shiftHint.length + 1 > actualWidth) {
					shiftHint = '';
				}
			}

			const fixedWidth =
				modeLabel.length +
				shiftHint.length +
				tuneSegment.length +
				ctxSegment.length +
				sessionSeparator.length +
				editorSeparator.length +
				editorPrefix.length +
				editorSuffix.length;

			const remaining = Math.max(0, actualWidth - fixedWidth - 1);

			let sessionMax = 0;
			let filenameMax = 0;
			if (sessionName && editorFileName) {
				const sessionNeed = sessionName.length;
				const filenameNeed = editorFileName.length;
				if (sessionNeed + filenameNeed <= remaining) {
					sessionMax = sessionNeed;
					filenameMax = filenameNeed;
				} else {
					const half = Math.floor(remaining / 2);
					if (sessionNeed <= half) {
						sessionMax = sessionNeed;
						filenameMax = remaining - sessionMax;
					} else if (filenameNeed <= half) {
						filenameMax = filenameNeed;
						sessionMax = remaining - filenameMax;
					} else {
						sessionMax = half;
						filenameMax = remaining - half;
					}
				}
			} else if (sessionName) {
				sessionMax = remaining;
			} else if (editorFileName) {
				filenameMax = remaining;
			}

			const session = sessionName
				? truncate(sessionName, Math.max(minLen, sessionMax))
				: null;
			const editor = editorFileName
				? `${editorPrefix}${truncate(
						editorFileName,
						Math.max(minLen, filenameMax),
					)}${editorSuffix}`
				: null;

			return {
				sessionLabel: session,
				editorLabel: editor,
				showShiftHint: shiftHint.length > 0,
			};
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
										developmentMode === 'headless'
									? colors.info
									: colors.warning
					}
				>
					<Text bold>{modeLabel}</Text>
					{showShiftHint && <Text> (Shift+Tab to cycle)</Text>}
				</Text>
				{sessionLabel && (
					<>
						<Text color={colors.secondary}> · </Text>
						<Text color={colors.primary}>{sessionLabel}</Text>
					</>
				)}
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
							ctx: {ctxPrefix}
							{contextPercentUsed}%
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
