/**
 * Plan Mode Phase Transition Detector
 *
 * Detects phase transitions in AI responses and updates plan mode state.
 * The AI is instructed to announce phase transitions using specific phrases,
 * and this module detects those phrases to update the plan phase state.
 */

import {getCurrentMode, getPlanId, setPlanPhase} from '@/context/mode-context';
import type {PlanPhase} from '@/types/core';
import {getLogger} from '@/utils/logging';

/**
 * Phase transition patterns to detect in AI responses
 * Each phase has multiple patterns that the AI might use to announce transitions
 */
const PHASE_TRANSITION_PATTERNS: Record<
	Exclude<PlanPhase, 'understanding'>,
	Array<{
		patterns: RegExp[];
		direction: 'forward' | 'backward' | 'any';
	}>
> = {
	design: [
		{
			patterns: [
				/moving to the design phase/i,
				/transitioning to design phase/i,
				/entering the design phase/i,
				/now in the design phase/i,
				/design phase:/i,
				// More flexible patterns
				/##\s*Design Phase/i,
				/\*\*Design Phase\*\*/i,
				/proceeding to design/i,
				/beginning design phase/i,
			],
			direction: 'forward',
		},
	],
	review: [
		{
			patterns: [
				/moving to the review phase/i,
				/transitioning to review phase/i,
				/entering the review phase/i,
				/now in the review phase/i,
				/review phase:/i,
				// More flexible patterns
				/##\s*Review Phase/i,
				/\*\*Review Phase\*\*/i,
				/proceeding to review/i,
				/beginning review phase/i,
				/consolidat(ing|e the) plan/i,
			],
			direction: 'forward',
		},
	],
	final: [
		{
			patterns: [
				/moving to the final plan phase/i,
				/transitioning to final plan phase/i,
				/entering the final plan phase/i,
				/now in the final plan phase/i,
				/final plan phase:/i,
				/moving to the final phase/i,
				// More flexible patterns
				/##\s*Final Plan Phase/i,
				/\*\*Final Plan Phase\*\*/i,
				/proceeding to final/i,
				/beginning final plan/i,
				/create(ing)? the final plan/i,
				/moving to create the executable/i,
			],
			direction: 'forward',
		},
	],
	exit: [
		{
			patterns: [
				/plan is complete/i,
				/plan is ready/i,
				/calling exit-plan-mode/i,
				/exiting plan mode/i,
				// More flexible patterns
				/\[EXIT_PLAN_MODE\]/i,
				/exit.?plan.?mode/i,
			],
			direction: 'forward',
		},
	],
};

/**
 * Phase ordering for validation
 */
const PHASE_ORDER: PlanPhase[] = [
	'understanding',
	'design',
	'review',
	'final',
	'exit',
];

/**
 * Get the index of a phase in the ordering
 */
function getPhaseIndex(phase: PlanPhase): number {
	return PHASE_ORDER.indexOf(phase);
}

/**
 * Check if a phase transition is valid based on current and target phases
 */
function isValidPhaseTransition(
	currentPhase: PlanPhase,
	targetPhase: PlanPhase,
): boolean {
	const currentIndex = getPhaseIndex(currentPhase);
	const targetIndex = getPhaseIndex(targetPhase);

	// Allow forward transitions
	if (targetIndex > currentIndex) {
		return true;
	}

	// Allow same phase (no-op)
	if (targetIndex === currentIndex) {
		return false; // No change needed
	}

	// Backward transitions are not allowed
	return false;
}

/**
 * Detect phase transition in AI response content
 *
 * @param content - The AI's response content
 * @param currentPhase - The current plan phase
 * @returns The new phase if transition detected, null otherwise
 */
export function detectPhaseTransition(
	content: string,
	currentPhase: PlanPhase,
): PlanPhase | null {
	// Only detect transitions if we're in plan mode
	const currentMode = getCurrentMode();
	if (currentMode !== 'plan') {
		return null;
	}

	// Only detect transitions if we have an active plan
	const planId = getPlanId();
	if (!planId) {
		return null;
	}

	const logger = getLogger();

	// Check each phase pattern
	for (const [targetPhase, patternGroups] of Object.entries(
		PHASE_TRANSITION_PATTERNS,
	)) {
		for (const patternGroup of patternGroups) {
			for (const pattern of patternGroup.patterns) {
				if (pattern.test(content)) {
					// Validate the transition
					if (!isValidPhaseTransition(currentPhase, targetPhase as PlanPhase)) {
						logger.debug('Invalid phase transition detected', {
							currentPhase,
							targetPhase,
							content: content.slice(0, 200),
						});
						continue;
					}

					logger.info('Phase transition detected', {
						from: currentPhase,
						to: targetPhase,
						pattern: pattern.source,
					});

					return targetPhase as PlanPhase;
				}
			}
		}
	}

	return null;
}

/**
 * Process AI response content and update plan phase if transition detected
 *
 * @param content - The AI's response content
 * @returns True if phase was updated, false otherwise
 */
export function processPhaseTransition(content: string): boolean {
	const currentMode = getCurrentMode();
	if (currentMode !== 'plan') {
		return false;
	}

	const planId = getPlanId();
	if (!planId) {
		return false;
	}

	const currentPhase = getCurrentPlanPhase();
	const logger = getLogger();

	// Log for debugging phase transitions
	logger.debug('Processing phase transition', {
		currentPhase,
		contentPreview: content.slice(0, 200),
	});

	const newPhase = detectPhaseTransition(content, currentPhase);

	if (newPhase && newPhase !== currentPhase) {
		logger.info('Updating plan phase', {
			from: currentPhase,
			to: newPhase,
		});
		setPlanPhase(newPhase);
		return true;
	}

	// Log if no transition was detected
	logger.debug('No phase transition detected', {
		currentPhase,
		contentHasMoving: /moving/i.test(content),
		contentHasPhase: /phase/i.test(content),
	});

	return false;
}

/**
 * Get the current plan phase from context
 * Import this from mode-context
 */
import {getPlanPhase as getCurrentPlanPhase} from '@/context/mode-context';
