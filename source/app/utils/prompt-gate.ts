/**
 * The app state that decides whether the user can start a new turn. Typed
 * input (the composer) and voice input (Ctrl+G / hands-free) must read the
 * same gate: when they drifted apart, voice could submit a turn straight past
 * an open /settings panel or the architect review gate.
 */
export interface PromptGateState {
	startChat: boolean;
	activeMode: string | null;
	isSettingsMode: boolean;
	planReviewState: {show: boolean} | null;
	architectReviewState: {show: boolean} | null;
	liveComponentCapturesInput: boolean;
}

/**
 * Whether the composer is mounted. Every modal surface (selectors, settings,
 * plan/architect review, a live component that captures input) unmounts it,
 * so nothing behind the modal can submit a prompt.
 */
export function canSubmitPrompt(state: PromptGateState): boolean {
	return (
		state.startChat &&
		state.activeMode === null &&
		!state.isSettingsMode &&
		!state.planReviewState?.show &&
		// The architect gate runs its own useInput. Leaving the composer
		// mounted alongside it gave every keystroke two live consumers,
		// and let the user submit a new turn straight past the gate with
		// the checkpoint still open.
		!state.architectReviewState?.show &&
		// Hide the composer only while a live component explicitly captures input.
		!state.liveComponentCapturesInput
	);
}

export interface VoiceGateState extends PromptGateState {
	isToolConfirmationMode: boolean;
	isQuestionMode: boolean;
	hasPendingSubagentApproval: boolean;
	hasPendingToolConfirmation: boolean;
}

/**
 * Whether a voice transcript may be submitted as a prompt. Same gate as the
 * composer, plus the decision prompts the composer renders in place of its
 * text box (tool confirmation, ask_user, subagent approval): typed input can't
 * submit there either, because the text box isn't showing.
 */
export function canSubmitVoicePrompt(state: VoiceGateState): boolean {
	return (
		canSubmitPrompt(state) &&
		!state.isToolConfirmationMode &&
		!state.isQuestionMode &&
		!state.hasPendingSubagentApproval &&
		!state.hasPendingToolConfirmation
	);
}
