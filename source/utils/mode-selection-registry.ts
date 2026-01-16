/**
 * Mode Selection Callback Registry
 *
 * Global registry for the mode selection callback.
 * Used by exit-plan-mode tool to trigger the interactive mode selection prompt.
 */

import type {DevelopmentMode} from '@/types/core';

export interface ModeSelectionOptions {
	/** Plan content to display in the preview */
	planContent?: string;
	/** Callback for when user selects "Modify Plan" */
	onModify?: () => void;
}

type ModeSelectionCallback = (
	onSelect: (mode: DevelopmentMode) => void,
	onCancel: () => void,
	options?: ModeSelectionOptions,
) => void;

let modeSelectionCallback: ModeSelectionCallback | null = null;

/**
 * Register a callback to be called when mode selection is needed
 */
export function registerModeSelectionCallback(
	callback: ModeSelectionCallback | null,
): void {
	modeSelectionCallback = callback;
}

/**
 * Trigger mode selection if a callback is registered
 */
export function triggerModeSelection(
	onSelect: (mode: DevelopmentMode) => void,
	onCancel: () => void,
	options?: ModeSelectionOptions,
): boolean {
	if (modeSelectionCallback) {
		modeSelectionCallback(onSelect, onCancel, options);
		return true;
	}
	return false;
}

/**
 * Check if mode selection callback is registered
 */
export function hasModeSelectionCallback(): boolean {
	return modeSelectionCallback !== null;
}
