import type {DevelopmentMode, PlanModeState, PlanPhase} from '@/types/core';

/**
 * Global development mode state
 * This is used by tool definitions to determine needsApproval dynamically
 * Updated via setCurrentMode() when mode changes in the UI
 */
let currentMode: DevelopmentMode = 'normal';

/**
 * Global plan mode state
 * Tracks the active plan during plan mode
 * Updated via setPlanId() and setPlanPhase() when entering/exiting plan mode
 */
let currentPlanId: string | null = null;
let currentPlanPhase: PlanPhase = 'understanding';
let currentPlanFilePath: string = '';

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

/**
 * Get the current plan ID
 * Returns null if not in plan mode
 */
export function getPlanId(): string | null {
	return currentPlanId;
}

/**
 * Set the current plan ID
 * Setting a non-null plan ID implicitly activates plan mode context
 * Setting to null clears the plan mode context
 */
export function setPlanId(planId: string | null): void {
	currentPlanId = planId;
}

/**
 * Get the current plan phase
 */
export function getPlanPhase(): PlanPhase {
	return currentPlanPhase;
}

/**
 * Set the current plan phase
 */
export function setPlanPhase(phase: PlanPhase): void {
	currentPlanPhase = phase;
}

/**
 * Get the current plan file path
 */
export function getPlanFilePath(): string {
	return currentPlanFilePath;
}

/**
 * Set the current plan file path
 */
export function setPlanFilePath(filePath: string): void {
	currentPlanFilePath = filePath;
}

/**
 * Get the complete plan mode state
 */
export function getPlanModeState(): PlanModeState {
	return {
		active: currentPlanId !== null,
		planId: currentPlanId,
		phase: currentPlanPhase,
		planFilePath: currentPlanFilePath,
	};
}

/**
 * Reset plan mode state to defaults
 * Called when exiting plan mode
 */
export function resetPlanModeState(): void {
	currentPlanId = null;
	currentPlanPhase = 'understanding';
	currentPlanFilePath = '';
}
