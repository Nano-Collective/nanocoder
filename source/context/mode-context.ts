import type {DevelopmentMode} from '@/types/core';

/**
 * Global development mode state
 * This is used by tool definitions to determine needsApproval dynamically
 * Updated via setCurrentMode() when mode changes in the UI
 */
let currentMode: DevelopmentMode = 'normal';

/**
 * Get the current development mode
 * Used by tool definitions to determine if approval is needed
 */
export function getCurrentMode(): DevelopmentMode {
	return currentMode;
}

/**
 * Set the current development mode
 * Called by the app when mode changes via Shift+Tab
 */
export function setCurrentMode(mode: DevelopmentMode): void {
	currentMode = mode;
}
