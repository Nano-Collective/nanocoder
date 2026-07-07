/**
 * Plan mode types for the interactive clarification system (Issue #96).
 *
 * These types describe the structure of pre-plan questions, the trigger
 * engine, and the clarification session state tracked in useAppState.
 */

import type {QuestionOptionMeta, QuestionType} from '@/utils/question-queue';

// ============================================================================
// Question definition
// ============================================================================

/** A single plan clarification question with optional rich option metadata. */
export interface PlanQuestion {
	id: string;
	type: QuestionType;
	question: string;
	/** Plain string labels (parallel to optionMeta). */
	options: string[];
	/** Optional rich metadata for each option (pros/cons, descriptions). */
	optionMeta?: QuestionOptionMeta[];
	allowFreeform?: boolean;
}

// ============================================================================
// Trigger engine
// ============================================================================

/** A keyword/pattern trigger that activates a clarification question. */
export interface QuestionTrigger {
	/** Substrings or lowercased keywords that activate the trigger. */
	patterns: string[];
	/** Minimum confidence score (0–1) required to surface the question. */
	confidence: number;
}

/** A template that may produce a PlanQuestion if its trigger fires. */
export interface QuestionTemplate {
	id: string;
	type: QuestionType;
	question: string;
	options: string[];
	optionMeta?: QuestionOptionMeta[];
	allowFreeform?: boolean;
	trigger: QuestionTrigger;
}

// ============================================================================
// Session state
// ============================================================================

/** Tracks the full lifecycle of a pre-plan clarification session. */
export interface PlanClarificationSession {
	/** Ordered queue of questions yet to be answered. */
	pending: PlanQuestion[];
	/** Map of question id → user's answer string. */
	answers: Record<string, string>;
	/** True when all pending questions have been answered or skipped. */
	isComplete: boolean;
}
