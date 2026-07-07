/**
 * usePlanClarification — Plan Mode pre-flight clarification hook (Issue #96)
 *
 * When the user submits a message in plan mode this hook:
 *   1. Runs the keyword trigger engine to generate a PlanQuestion queue.
 *   2. Presents each question one at a time via the existing signalQuestion
 *      / QuestionPrompt stack (reuses the ask_user tool infrastructure).
 *   3. Collects answers and resolves when all questions are answered or skipped.
 *   4. Returns the collected answers for injection into the system prompt context.
 *
 * Usage in App.tsx:
 *
 *   const { runClarification } = usePlanClarification();
 *   // Before dispatching to the AI:
 *   const answers = await runClarification(userMessage);
 *   // Inject answers into context and dispatch.
 */

import {buildClarificationQuestions} from '@/plan/clarification-questions';
import type {DevelopmentMode} from '@/types/core';
import type {PlanQuestion} from '@/types/plan';
import {signalQuestion} from '@/utils/question-queue';

export interface PlanClarificationAnswers {
	/** Map of question id → user answer. */
	answers: Record<string, string>;
	/** Questions that were presented (may be fewer than generated if skipped). */
	asked: PlanQuestion[];
}

export interface UsePlanClarificationReturn {
	/**
	 * Runs the pre-plan clarification flow for a given user message.
	 * Only fires when developmentMode === 'plan'.
	 * Resolves immediately (empty answers) for other modes or clear messages.
	 */
	runClarification: (
		message: string,
		developmentMode: DevelopmentMode,
	) => Promise<PlanClarificationAnswers>;
}

/**
 * Standalone async function (not a hook) so it can be tested and called
 * from non-React contexts (e.g. event handlers in App.tsx).
 */
export async function runClarification(
	message: string,
	developmentMode: DevelopmentMode,
): Promise<PlanClarificationAnswers> {
	// Only run in plan mode
	if (developmentMode !== 'plan') {
		return {answers: {}, asked: []};
	}

	const questions = buildClarificationQuestions(message);

	if (questions.length === 0) {
		return {answers: {}, asked: []};
	}

	const answers: Record<string, string> = {};
	const asked: PlanQuestion[] = [];

	for (const question of questions) {
		try {
			const answer = await signalQuestion({
				question: question.question,
				options: question.options,
				allowFreeform: question.allowFreeform ?? true,
				questionType: question.type,
				optionMeta: question.optionMeta,
			});

			// User declined ("User declined to answer") means they want to skip
			if (answer !== 'User declined to answer') {
				answers[question.id] = answer;
				asked.push(question);
			}
		} catch {
			// If the question handler is not ready (e.g. tests), skip gracefully
			break;
		}
	}

	return {answers, asked};
}

/**
 * Hook wrapper — just exposes the standalone function for use in React components.
 * Kept as a hook so callers can be switched to a more stateful variant in the future.
 */
export function usePlanClarification(): UsePlanClarificationReturn {
	return {runClarification};
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Formats collected clarification answers into a context string that can
 * be prepended to the AI's system prompt or first user message.
 */
export function formatClarificationContext(
	results: PlanClarificationAnswers,
): string {
	if (results.asked.length === 0) return '';

	const lines = ['## Pre-plan clarifications\n'];
	for (const question of results.asked) {
		const answer = results.answers[question.id];
		if (answer) {
			lines.push(`**${question.question}**`);
			lines.push(`→ ${answer}\n`);
		}
	}

	return lines.join('\n');
}
