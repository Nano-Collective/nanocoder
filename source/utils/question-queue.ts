// Global question queue - allows the ask_question tool to present
// interactive questions to the user via the UI.
//
// Pattern mirrors message-queue.tsx: a module-level singleton handler
// set by App.tsx, called from the tool's execute function.

export interface PendingQuestion {
	question: string;
	options: string[];
	allowFreeform: boolean;
}

// The handler set by App.tsx. It receives the question data and returns
// a Promise<string> that resolves when the user picks an answer.
let globalQuestionHandler:
	| ((question: PendingQuestion) => Promise<string>)
	| null = null;

/**
 * Called once from App.tsx to wire up the UI handler.
 */
export function setGlobalQuestionHandler(
	handler: (question: PendingQuestion) => Promise<string>,
) {
	globalQuestionHandler = handler;
}

/**
 * Called from the ask_question tool's execute function.
 * Returns a Promise that resolves with the user's answer string.
 */
export async function signalQuestion(
	question: PendingQuestion,
): Promise<string> {
	if (!globalQuestionHandler) {
		return 'Error: Question handler not initialized. The UI is not ready to accept questions.';
	}
	return globalQuestionHandler(question);
}
