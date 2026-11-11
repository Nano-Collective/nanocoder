import {useCallback, useEffect, useRef} from 'react';
import {promptHistory} from '@/prompt-history';
import type {InputState} from '@/types/hooks';

interface UsePromptHistoryNavigationOptions {
	input: string;
	currentState: InputState;
	/**
	 * Position in history, owned by useInputState: -1 while composing, -2 on
	 * the saved draft between the two ends of history, otherwise the index of
	 * the recalled prompt.
	 */
	historyIndex: number;
	setHistoryIndex: (index: number) => void;
	setOriginalInput: (input: string) => void;
	setInputState: (state: InputState) => void;
	/** Remount TextInput after a recalled prompt replaces the input. Stable. */
	onInputReplaced: () => void;
}

/**
 * ↑/↓ through prompt history from a single-line prompt. The first step away
 * from the prompt saves it as a draft; walking past either end of history
 * lands back on that draft, and one more step wraps to the other end.
 */
export function usePromptHistoryNavigation({
	input,
	currentState,
	historyIndex,
	setHistoryIndex,
	setOriginalInput,
	setInputState,
	onInputReplaced,
}: UsePromptHistoryNavigationOptions) {
	// True while the current input came from history navigation (↑/↓), not
	// typing. A recalled `/command` must NOT auto-open the suggestion menu,
	// otherwise the menu captures ↑/↓ and history navigation is blocked.
	// Cleared on any keystroke so editing the recalled command surfaces
	// suggestions again.
	const inputFromHistoryRef = useRef(false);
	// The prompt as it was when history navigation started, so it can be put back.
	const savedDraftRef = useRef<InputState>({
		displayValue: '',
		placeholderContent: {},
	});

	useEffect(() => {
		void promptHistory.loadHistory();
	}, []);

	/** The user typed: the input is theirs again, not a recalled prompt. */
	const markTyped = useCallback(() => {
		inputFromHistoryRef.current = false;
	}, []);

	const navigate = useCallback(
		(direction: 'up' | 'down') => {
			const history = promptHistory.getHistory();
			if (history.length === 0) return;

			// This value is being recalled, not typed — suppress the auto-show so a
			// recalled `/command` doesn't hijack ↑/↓ from further history navigation.
			inputFromHistoryRef.current = true;

			const show = (index: number, state: InputState) => {
				setHistoryIndex(index);
				setInputState(state);
				onInputReplaced();
			};

			if (direction === 'up') {
				if (historyIndex === -1) {
					// Save the full current state before starting navigation
					savedDraftRef.current = currentState;
					setOriginalInput(input);
					show(history.length - 1, history[history.length - 1]);
				} else if (historyIndex > 0) {
					show(historyIndex - 1, history[historyIndex - 1]);
				} else if (historyIndex === 0) {
					// At first history item, restore saved draft
					show(-2, savedDraftRef.current);
				} else if (historyIndex === -2) {
					// At draft, cycle back to last history item
					savedDraftRef.current = currentState;
					show(history.length - 1, history[history.length - 1]);
				}
			} else {
				if (historyIndex === -1) {
					// Save draft, go to draft cycling state (visually a no-op)
					savedDraftRef.current = currentState;
					setOriginalInput(input);
					show(-2, savedDraftRef.current);
				} else if (historyIndex === -2) {
					// At draft, cycle to first history item
					savedDraftRef.current = currentState;
					show(0, history[0]);
				} else if (historyIndex >= 0 && historyIndex < history.length - 1) {
					// Move forward in history
					show(historyIndex + 1, history[historyIndex + 1]);
				} else if (historyIndex === history.length - 1) {
					// At last history item, restore saved draft
					show(-2, savedDraftRef.current);
				}
			}
		},
		[
			historyIndex,
			input,
			currentState,
			setHistoryIndex,
			setOriginalInput,
			setInputState,
			onInputReplaced,
		],
	);

	return {navigate, markTyped, inputFromHistoryRef};
}
