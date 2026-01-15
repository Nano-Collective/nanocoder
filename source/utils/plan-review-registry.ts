/**
 * Plan Review Callback Registry
 *
 * Global registry for the plan review callback.
 * Used by write_file tool to trigger interactive plan review before saving.
 */

import type {PlanPhase} from '@/types/core';

export interface PlanReviewData {
	planId: string;
	planFilePath: string;
	content: string;
	currentPhase: PlanPhase;
}

type PlanReviewCallback = (
	data: PlanReviewData,
	onApprove: () => void,
	onReject: () => void,
) => void;

let planReviewCallback: PlanReviewCallback | null = null;

/**
 * Register a callback to be called when plan review is needed
 */
export function registerPlanReviewCallback(
	callback: PlanReviewCallback | null,
): void {
	planReviewCallback = callback;
}

/**
 * Trigger plan review if a callback is registered
 */
export function triggerPlanReview(
	data: PlanReviewData,
	onApprove: () => void,
	onReject: () => void,
): boolean {
	if (planReviewCallback) {
		planReviewCallback(data, onApprove, onReject);
		return true;
	}
	return false;
}

/**
 * Check if plan review callback is registered
 */
export function hasPlanReviewCallback(): boolean {
	return planReviewCallback !== null;
}
