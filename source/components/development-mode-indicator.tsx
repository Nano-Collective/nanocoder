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
import type {
	ContextSource,
	DevelopmentMode,
	TaskIndicatorInfo,
} from '@/types/core';
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
	taskInfo?: TaskIndicatorInfo | null;
	isSaving?: boolean;
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
		taskInfo,
		isSaving,
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

		// Two forms of the task badge. The base form is the progress readout,
		// which only exists while the list is collapsed and is the sole trace of
		// it on screen, so it always renders. The Ctrl-t key hint on top of that
		// is a help string: worth showing when there is room, first to go when
		// there isn't (see the drop order below). When the list is expanded there
		// is no progress to report, so only the hint form exists.
		const {taskLabelBase, taskLabelWithHint} = (() => {
			if (!taskInfo || taskInfo.totalCount <= 0) {
				return {taskLabelBase: '', taskLabelWithHint: ''};
			}
			if (!taskInfo.isHidden) {
				return {taskLabelBase: '', taskLabelWithHint: 'Tasks (hide Ctrl-t)'};
			}
			const inFlight = taskInfo.inProgressCount > 0 ? '~' : '';
			const unread = taskInfo.hasUnread ? '*' : '';
			const progress = `${inFlight}${taskInfo.completedCount}/${taskInfo.totalCount}${unread}`;
			return {
				taskLabelBase: `Tasks (${progress})`,
				taskLabelWithHint: `Tasks (${progress} Ctrl-t)`,
			};
		})();

		// Figures with any client-side estimation ('estimate', or 'api+estimate'
		// where the estimated tail moved the number) render with a leading '~'
		// (≈); fully API-reported figures render bare. The marker is a single
		// char so it barely affects the width budget below, where ctx never
		// truncates.
		const ctxPrefix = contextSource === 'api' ? '' : '~';

		// Mode, tune, ctx, and the collapsed-task progress readout never
		// truncate. Session name and the filename portion of the editor pill
		// share whatever room is left, each truncating with an ellipsis; if both
		// fit fully neither truncates; if both overflow they split the remaining
		// space evenly.
		// The Ctrl-t hint, the saving indicator, the line-range suffix and
		// the (Shift+Tab to cycle) hint are optional — drop them when otherwise
		// the row would wrap. The Ctrl-t hint drops first, then the saving
		// indicator, then the line-range suffix, then the shift hint.
		const {sessionLabel, editorLabel, showShiftHint, taskLabel, showSaving} =
			(() => {
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
				const taskBaseSegment = taskLabelBase ? ` · ${taskLabelBase}` : '';
				const taskHintSegment = taskLabelWithHint
					? ` · ${taskLabelWithHint}`
					: '';
				// Cost of upgrading the badge from its base form to the key-hint
				// form. With the list expanded there is no base form, so this is the
				// price of the whole segment.
				const taskHintExtraFull =
					taskHintSegment.length - taskBaseSegment.length;
				const savingSegment = isSaving ? ' · saving' : '';
				const savingExtraFull = savingSegment.length;
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
					taskBaseSegment.length +
					ctxSegment.length +
					sessionSeparator.length +
					editorSeparator.length +
					editorPrefix.length +
					minSessionLen +
					minEditorLen;

				// Decide which optional segments fit. Drop the Ctrl-t hint first,
				// then the saving indicator, then the suffix, then the shift hint,
				// until the row fits within actualWidth.
				let editorSuffix = editorSuffixFull;
				let shiftHint = shiftHintFull;
				let taskHintExtra = taskHintExtraFull;
				let savingExtra = savingExtraFull;
				if (
					requiredWidth +
						taskHintExtra +
						savingExtra +
						editorSuffix.length +
						shiftHint.length +
						1 >
					actualWidth
				) {
					taskHintExtra = 0;
					if (
						requiredWidth +
							savingExtra +
							editorSuffix.length +
							shiftHint.length +
							1 >
						actualWidth
					) {
						savingExtra = 0;
						if (
							requiredWidth + editorSuffix.length + shiftHint.length + 1 >
							actualWidth
						) {
							editorSuffix = '';
							if (requiredWidth + shiftHint.length + 1 > actualWidth) {
								shiftHint = '';
							}
						}
					}
				}

				const fixedWidth =
					modeLabel.length +
					shiftHint.length +
					tuneSegment.length +
					taskBaseSegment.length +
					taskHintExtra +
					savingExtra +
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
					taskLabel: taskHintExtra > 0 ? taskLabelWithHint : taskLabelBase,
					showSaving: savingExtra > 0,
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
				{taskLabel && (
					<>
						<Text color={colors.secondary}> · </Text>
						<Text
							color={taskInfo?.hasUnread ? colors.warning : colors.secondary}
						>
							{taskLabel}
						</Text>
					</>
				)}
				{showSaving && (
					<>
						<Text color={colors.secondary}> · </Text>
						<Text color={colors.info} italic>
							saving
						</Text>
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
