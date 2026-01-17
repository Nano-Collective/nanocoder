/**
 * Question Selection Callback Registry
 *
 * Global registry for the question prompt callback.
 * Used by ask_user_question tool to trigger interactive question prompts.
 */

import {getLogger} from '@/utils/logging';

/**
 * Schema for a single question option
 */
export interface QuestionOption {
	label: string;
	description: string;
}

/**
 * Schema for a single question
 */
export interface Question {
	question: string;
	header: string;
	options: QuestionOption[];
	multiSelect: boolean;
}

/**
 * Options for question prompt
 */
export interface QuestionPromptOptions {
	/** Callback for when user submits their answers */
	onSubmit: (answers: Record<string, string>) => void;
	/** Callback for when user cancels */
	onCancel: () => void;
}

type QuestionPromptCallback = (
	questions: Question[],
	onSubmit: (answers: Record<string, string>) => void,
	onCancel: () => void,
) => void;

let questionPromptCallback: QuestionPromptCallback | null = null;

/**
 * Register a callback to be called when questions need to be asked
 */
export function registerQuestionPromptCallback(
	callback: QuestionPromptCallback | null,
): void {
	const logger = getLogger();
	if (callback) {
		logger.debug('[QUESTION_PROMPT] Callback registered');
	} else {
		logger.debug('[QUESTION_PROMPT] Callback unregistered');
	}
	questionPromptCallback = callback;
}

/**
 * Trigger question prompt if a callback is registered
 */
export function triggerQuestionPrompt(
	questions: Question[],
	onSubmit: (answers: Record<string, string>) => void,
	onCancel: () => void,
): boolean {
	const logger = getLogger();
	logger.info('[QUESTION_PROMPT] triggerQuestionPrompt called', {
		questionCount: questions.length,
		hasCallback: !!questionPromptCallback,
	});

	if (questionPromptCallback) {
		logger.info('[QUESTION_PROMPT] Calling registered callback');
		questionPromptCallback(questions, onSubmit, onCancel);
		return true;
	}

	logger.warn(
		'[QUESTION_PROMPT] No callback registered - question prompt not triggered',
	);
	return false;
}

/**
 * Check if question prompt callback is registered
 */
export function hasQuestionPromptCallback(): boolean {
	return questionPromptCallback !== null;
}
