import {useEffect, useRef} from 'react';
import {sendNotification} from '@/utils/notifications';

interface NotificationState {
	isToolConfirmationMode: boolean;
	isQuestionMode: boolean;
	isGenerating: boolean;
	isToolExecuting: boolean;
}

/**
 * Sends desktop notifications when the app transitions to states
 * that require user input.
 */
export function useNotifications(state: NotificationState): void {
	const prev = useRef<NotificationState>(state);

	useEffect(() => {
		const p = prev.current;

		// Tool confirmation just appeared
		if (state.isToolConfirmationMode && !p.isToolConfirmationMode) {
			sendNotification('toolConfirmation');
		}

		// Question prompt just appeared
		if (state.isQuestionMode && !p.isQuestionMode) {
			sendNotification('questionPrompt');
		}

		// Generation just finished (was generating or executing, now idle and waiting for input)
		if (
			(p.isGenerating || p.isToolExecuting) &&
			!state.isGenerating &&
			!state.isToolExecuting &&
			!state.isToolConfirmationMode &&
			!state.isQuestionMode
		) {
			sendNotification('generationComplete');
		}

		prev.current = state;
	}, [
		state.isToolConfirmationMode,
		state.isQuestionMode,
		state.isGenerating,
		state.isToolExecuting,
		state,
	]);
}
