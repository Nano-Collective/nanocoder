// Global question queue - allows the ask_question tool to present
// interactive questions to the user via the UI.

import {createGlobalHandlerSlot} from '@/utils/global-handler-slot';

/** Classifies a question: ambiguity, decision, or confirmation. */
export type QuestionType = 'ambiguity' | 'decision' | 'confirmation';

/** Rich metadata for a single option (used for pros/cons display). */
export interface QuestionOptionMeta {
	label: string;
	description?: string;
	pros?: string[];
	cons?: string[];
}

export interface PendingQuestion {
	question: string;
	options: string[];
	allowFreeform: boolean;
	questionType?: QuestionType;
	optionMeta?: QuestionOptionMeta[];
}

const questionSlot = createGlobalHandlerSlot<PendingQuestion, string>(
	() =>
		'Error: Question handler not initialized. The UI is not ready to accept questions.',
);

/** Called once from App.tsx to wire up the UI handler. */
export const setGlobalQuestionHandler = questionSlot.set;

/**
 * Called from the ask_question tool's execute function.
 * Returns a Promise that resolves with the user's answer string.
 */
export const signalQuestion = questionSlot.signal;
