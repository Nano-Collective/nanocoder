/**
 * Mode Selection Callback Registry
 *
 * Global registry for the mode selection callback.
 * Used by exit-plan-mode tool to trigger the interactive mode selection prompt.
 */

import type {DevelopmentMode} from '@/types/core';
import {getLogger} from '@/utils/logging';

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
	const logger = getLogger();
	if (callback) {
		logger.debug('[MODE_SELECTION_REGISTRY] Callback registered');
	} else {
		logger.debug('[MODE_SELECTION_REGISTRY] Callback unregistered');
	}
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
	const logger = getLogger();
	logger.info('[MODE_SELECTION_REGISTRY] triggerModeSelection called', {
		hasCallback: !!modeSelectionCallback,
		hasOptions: !!options,
	});

	if (modeSelectionCallback) {
		logger.info('[MODE_SELECTION_REGISTRY] Calling registered callback');
		modeSelectionCallback(onSelect, onCancel, options);
		return true;
	}

	logger.warn(
		'[MODE_SELECTION_REGISTRY] No callback registered - mode selection not triggered',
	);
	return false;
}

/**
 * Check if mode selection callback is registered
 */
export function hasModeSelectionCallback(): boolean {
	return modeSelectionCallback !== null;
}
