import {Box, Text, useFocus, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {useCallback, useEffect, useRef, useState} from 'react';
import {AttachmentPills} from '@/components/composer/attachment-pills';
import {CommandCompletionList} from '@/components/composer/command-completion-list';
import {FileMentionList} from '@/components/composer/file-mention-list';
import {isComposerKey} from '@/components/composer/keymap';
import {QueuedMessageList} from '@/components/composer/queued-message-list';
import {ReverseSearchPrompt} from '@/components/composer/reverse-search-prompt';
import {ShortcutsOverlay} from '@/components/composer/shortcuts-overlay';
import {useCommandCompletions} from '@/components/composer/useCommandCompletions';
import {useFileMentions} from '@/components/composer/useFileMentions';
import {
	collectDroppedImages,
	useImageAttachments,
} from '@/components/composer/useImageAttachments';
import {useQueuedMessageSelection} from '@/components/composer/useQueuedMessageSelection';
import {useReverseSearch} from '@/components/composer/useReverseSearch';
import {useShortcutsOverlay} from '@/components/composer/useShortcutsOverlay';
import {
	DevelopmentModeIndicator,
	type VoiceIndicatorInfo,
} from '@/components/development-mode-indicator';
import TextInput, {
	type TextInputHandle,
	useRawInput,
} from '@/components/text-input';
import {useInputState} from '@/hooks/useInputState';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {useUIStateContext} from '@/hooks/useUIState';
import type {
	QueuedUserMessage,
	UserMessageQueueDraft,
} from '@/hooks/useUserMessageQueue';
import {promptHistory} from '@/prompt-history';
import type {TuneConfig} from '@/types/config';
import type {
	ContextSource,
	DevelopmentMode,
	ImageAttachment,
	TaskIndicatorInfo,
} from '@/types/core';
import type {
	InputState,
	RestoredInputDraft,
	SubmittedInputDraft,
} from '@/types/hooks';
import {isNewlineKey} from '@/utils/newline-key';
import {assemblePrompt} from '@/utils/prompt-processor';
import {pasteEvents} from '@/utils/terminal-paste';
import {getVisualLineSegments} from '@/utils/text-wrapping';
import type {ActiveEditorState} from '@/vscode/vscode-server';

// Prompt box width floor: keeps narrow terminals legible.
const PROMPT_WIDTH_MIN = 40;

interface ChatProps {
	onSubmit?: (
		message: string,
		displayValue: string,
		images?: ImageAttachment[],
	) => void;
	onQueueMessage?: (message: UserMessageQueueDraft) => void;
	queuedMessages?: QueuedUserMessage[];
	onRemoveQueuedMessage?: (id: string) => void;
	placeholder?: string;
	customCommands?: string[]; // List of custom command names and aliases
	disabled?: boolean; // Disable input when AI is processing
	isBusy?: boolean; // True when in-flight work is cancellable; Escape is owned by the global handler, so it must not clear the input
	onToggleMode?: () => void; // Callback when user presses shift+tab to toggle development mode
	onToggleReasoningExpanded?: () => void; // Callback when user presses ctrl+n to toggle expanded reasoning traces
	onToggleCompactDisplay?: () => void; // Callback when user presses ctrl+o to toggle compact tool display
	onToggleTaskList?: () => void; // Callback when user presses ctrl+t to collapse/expand the live task list
	compactToolDisplay?: boolean; // Current compact display state
	developmentMode?: DevelopmentMode; // Current development mode
	contextPercentUsed?: number | null; // Context window usage percentage
	contextSource?: ContextSource | null; // Whether ctx % is API-reported or estimated
	sessionName?: string; // Optional session name for display
	tune?: TuneConfig; // Model mode configuration
	currentModel?: string; // Active model id — resolves the 'auto' tune profile for display
	activeEditor?: ActiveEditorState | null; // VS Code active file + optional selection
	onDismissActiveEditor?: () => void; // Dismiss the active editor pill on clear/escape
	taskInfo?: TaskIndicatorInfo | null; // Task badge status for DevelopmentModeIndicator
	forceFocus?: boolean; // Force focus for testing (bypasses useFocus)
	/**
	 * Centre the prompt box in the terminal. Inline mode turns this off: the
	 * transcript is printed by Ink's <Static> at column 0, which no wrapper can
	 * shift, so the box shares that left edge instead of sitting inset from it.
	 */
	centered?: boolean;
	onSubmittedDraft?: (draft: SubmittedInputDraft) => void;
	restoreSubmittedDraft?: RestoredInputDraft | null;
	isSaving?: boolean;
	voice?: VoiceIndicatorInfo | null; // Voice mode state for the mode line
	suggestedCommand?: string | null; // Follow-up command shown in the empty prompt; Tab inserts it, Esc dismisses it
	onDismissSuggestion?: () => void;
	/**
	 * Fullscreen keeps the root box's left padding (inline pulls the composer
	 * back over it), so the status row sits one column further right and has
	 * one column less to fill.
	 */
	fullscreen?: boolean;
	/**
	 * Fires when the `?` shortcuts overlay opens or closes. The overlay sizes
	 * itself as if it had the footer to itself and takes over PgUp/PgDn, so
	 * the parent hides its other footer rows and pauses its own scrolling.
	 */
	onShortcutsOverlayChange?: (open: boolean) => void;
}

export default function UserInput({
	onSubmit,
	onQueueMessage,
	queuedMessages = [],
	onRemoveQueuedMessage,
	placeholder,
	customCommands = [],
	disabled = false,
	isBusy = false,
	onToggleMode,
	onToggleReasoningExpanded,
	onToggleCompactDisplay,
	onToggleTaskList,
	compactToolDisplay = true,
	developmentMode = 'normal',
	contextPercentUsed,
	contextSource,
	sessionName,
	tune,
	currentModel,
	activeEditor,
	onDismissActiveEditor,
	taskInfo,
	forceFocus = false,
	centered = true,
	onSubmittedDraft,
	restoreSubmittedDraft = null,
	isSaving,
	voice,
	suggestedCommand = null,
	onDismissSuggestion,
	fullscreen = false,
	onShortcutsOverlayChange,
}: ChatProps) {
	const {isFocused, focus} = useFocus({autoFocus: !disabled, id: 'user-input'});
	const effectiveFocus = forceFocus || isFocused;
	const {colors} = useTheme();
	const inputState = useInputState();
	const uiState = useUIStateContext();
	const {isNarrow, actualWidth, truncate} = useResponsiveTerminal();
	// Prompt spans the full terminal width at every size (minus a 4-col
	// margin so the rounded border never wraps and shatters), floored at 40
	// cols for legibility on tiny terminals. Clamped back down to actualWidth
	// so that floor can never exceed the parent it's centered in - Ink centers
	// an over-wide child by giving it a negative left offset, which clips the
	// border, the prompt marker, and the start of the text instead of the end.
	const promptWidth = Math.min(
		actualWidth,
		Math.max(PROMPT_WIDTH_MIN, actualWidth - 4),
	);
	// Must match the wrapWidth passed to TextInput below — both sides use it to
	// decide whether Up/Down means line navigation or history.
	const inputWrapWidth = promptWidth - 4;
	// One column right of the box's left border, plus 1 more in fullscreen
	// for the root box's left padding, which inline cancels (see
	// ChatInput's wrapper). Centred adds the ~2-column inset a box narrower
	// than its container gets from being centred rather than flush left.
	const indicatorIndent = (centered ? 3 : 1) + (fullscreen ? 1 : 0);
	const [textInputKey, setTextInputKey] = useState(0);
	// Imperative handle into TextInput so the terminal paste path can read the
	// caret position before the splice and put it back after. Without this the
	// pasted text would always land at the end of the value.
	const textInputRef = useRef<TextInputHandle>(null);
	// True while the current input came from history navigation (↑/↓), not typing.
	// A recalled `/command` must NOT auto-open the suggestion menu — otherwise the
	// menu captures ↑/↓ and history navigation is blocked. Cleared on any keystroke
	// so editing the recalled command surfaces suggestions again.
	const inputFromHistoryRef = useRef(false);
	// Store the full InputState draft when starting history navigation, so it can be restored
	const savedDraftRef = useRef<InputState>({
		displayValue: '',
		placeholderContent: {},
	});
	// Pending image attachments sent with the next submitted message.
	const images = useImageAttachments();
	const {attachments} = images;
	const lastRestoredDraftIdRef = useRef<number | null>(null);

	// Reverse prompt search (Ctrl+R / bck-i-search)
	const reverseSearch = useReverseSearch();
	const isReverseSearchMode = reverseSearch.isActive;

	const {
		input,
		historyIndex,
		setOriginalInput,
		setHistoryIndex,
		updateInput,
		resetInput,
		deletePlaceholder: _deletePlaceholder,
		currentState,
		currentStateRef,
		setInputState,
		undo,
		redo,
		insertPaste,
	} = inputState;

	// Read through refs in key handlers: both our useInput and TextInput's see
	// every keystroke, and either handler can still hold a render-old closure.
	const inputRef = useRef(input);
	inputRef.current = input;
	const shortcuts = useShortcutsOverlay(onShortcutsOverlayChange);
	const showShortcuts = shortcuts.isOpen;
	const isShortcutsOpenNow = shortcuts.isOpenNow;

	const {showClearMessage, setShowClearMessage, resetUIState} = uiState;

	// Check if we're in bash mode (input starts with !)
	const isBashMode = input.trim().startsWith('!');

	// Load history on mount
	useEffect(() => {
		void promptHistory.loadHistory();
	}, []);

	// Real pastes, as reported by the terminal via bracketed paste. The
	// payload is lifted off stdin before Ink's keypress parser sees it, so
	// a multi-line paste can no longer submit the prompt on its first
	// newline — it arrives here whole, in one event.
	useEffect(() => {
		if (disabled || !effectiveFocus) {
			return;
		}
		const handleTerminalPaste = (payload: string) => {
			// Read the caret off TextInput so the splice lands where the user
			// was editing, not at the end of the value. insertPaste returns the
			// new cursor offset; fall back to a remount only if no cursor is
			// available (TextInput not yet mounted).
			const cursorOffset = textInputRef.current?.getCursorOffset();
			const result = insertPaste(payload, cursorOffset);
			if (result && textInputRef.current) {
				// Hand TextInput the pasted value along with the caret: keys in the
				// same stdin batch as the paste land before it re-renders, and
				// must edit the pasted value, not the one it last rendered.
				textInputRef.current.setCursorOffset(
					result.cursorOffset,
					currentStateRef.current.displayValue,
				);
			} else if (!result) {
				setTextInputKey(prev => prev + 1);
			}
		};
		pasteEvents.on('paste', handleTerminalPaste);
		return () => {
			pasteEvents.off('paste', handleTerminalPaste);
		};
	}, [disabled, effectiveFocus, insertPaste, currentStateRef]);

	useEffect(() => {
		if (
			!restoreSubmittedDraft ||
			lastRestoredDraftIdRef.current === restoreSubmittedDraft.id
		) {
			return;
		}

		lastRestoredDraftIdRef.current = restoreSubmittedDraft.id;
		setInputState({
			displayValue: restoreSubmittedDraft.inputState.displayValue,
			placeholderContent: {
				...restoreSubmittedDraft.inputState.placeholderContent,
			},
		});
		images.replace([...restoreSubmittedDraft.attachments]);
		resetUIState();
		promptHistory.resetIndex();
		setTextInputKey(prev => prev + 1);
		focus('user-input');
	}, [
		restoreSubmittedDraft,
		setInputState,
		resetUIState,
		focus,
		images.replace,
	]);

	// When in-flight work ends, reclaim focus so the cursor returns and the user
	// can type right away. Focus can be dropped mid-turn (e.g. an interstitial
	// tool-confirmation prompt unmounts the input), and useFocus autoFocus only
	// fires on mount, so we restore it on the busy -> idle edge.
	const wasBusyRef = useRef(isBusy);
	useEffect(() => {
		if (wasBusyRef.current && !isBusy && !disabled) {
			focus('user-input');
		}
		wasBusyRef.current = isBusy;
	}, [isBusy, disabled, focus]);

	const remountTextInput = useCallback(
		() => setTextInputKey(prev => prev + 1),
		[],
	);
	// Picking, editing and removing queued messages from an empty prompt.
	const loadQueuedForEditing = useCallback(
		(message: QueuedUserMessage) => {
			setInputState(
				message.inputState ?? {
					displayValue: message.displayValue,
					placeholderContent: {},
				},
			);
			images.replace(message.images ?? []);
			remountTextInput();
		},
		[setInputState, images.replace, remountTextInput],
	);

	const queue = useQueuedMessageSelection({
		queuedMessages,
		input,
		onRemoveQueuedMessage,
		onLoadForEditing: loadQueuedForEditing,
	});
	// `@` file / MCP-resource mentions and the explorer's file handoff.
	const mentions = useFileMentions({
		input,
		currentState,
		setInputState,
		onInputReplaced: remountTextInput,
	});
	const isFileAutocompleteMode = mentions.isActive;

	// Slash-command completion menu.
	const commands = useCommandCompletions({
		input,
		currentState,
		latestStateRef: currentStateRef,
		customCommands,
		isMentionActive: isFileAutocompleteMode,
		inputFromHistoryRef,
		setInputState,
		onInputReplaced: remountTextInput,
	});

	// Helper functions

	// Handle form submission
	const handleSubmit = useCallback(() => {
		if (!onSubmit && !onQueueMessage) return;

		// The ref, not the render-time currentState: Enter can arrive in the
		// same stdin batch as a paste, before this component re-renders with it.
		const latestState = currentStateRef.current;
		const dropped = collectDroppedImages(
			attachments,
			assemblePrompt(latestState),
			latestState.displayValue,
		);
		const {assembled, display} = dropped;
		const outgoing = dropped.images;

		// Nothing to send: no text and no attachments.
		if (!assembled.trim() && outgoing.length === 0) return;

		const inputStateForHistory: InputState = {
			displayValue: latestState.displayValue,
			placeholderContent: {...latestState.placeholderContent},
		};

		if (isBusy && !assembled.trim().startsWith('/') && onQueueMessage) {
			promptHistory.addPrompt(inputStateForHistory);
			onQueueMessage({
				message: assembled,
				displayValue: display,
				images: outgoing.length > 0 ? outgoing : undefined,
				inputState: inputStateForHistory,
			});
			resetInput();
			resetUIState();
			images.clear();
			promptHistory.resetIndex();
			queue.resetSelection();
			return;
		}

		if (!onSubmit) return;

		// Save the InputState to history and send assembled message to AI
		promptHistory.addPrompt(inputStateForHistory);
		onSubmittedDraft?.({
			inputState: inputStateForHistory,
			attachments: outgoing,
		});
		onSubmit(assembled, display, outgoing.length > 0 ? outgoing : undefined);
		onDismissSuggestion?.();
		resetInput();
		resetUIState();
		images.clear();
		promptHistory.resetIndex();
		queue.resetSelection();
	}, [
		attachments,
		onSubmit,
		onQueueMessage,
		resetInput,
		resetUIState,
		currentStateRef,
		isBusy,
		onSubmittedDraft,
		onDismissSuggestion,
		images.clear,
		queue.resetSelection,
	]);

	// Handle escape key logic
	const handleEscape = useCallback(() => {
		if (commands.isOpen) {
			commands.dismiss();
			return;
		}
		if (isFileAutocompleteMode) {
			mentions.dismiss();
			return;
		}
		// Esc in an empty prompt dismisses the suggested command first.
		if (suggestedCommand && input === '') {
			onDismissSuggestion?.();
			return;
		}
		if (showClearMessage) {
			resetInput();
			resetUIState();
			images.clear();
			onDismissActiveEditor?.();
			focus('user-input');
		} else if (input || attachments.length > 0 || activeEditor) {
			// Nothing to clear otherwise - no-op instead of arming a hint for a
			// second Escape that would have nothing to do either.
			setShowClearMessage(true);
		}
	}, [
		input,
		attachments,
		activeEditor,
		commands.isOpen,
		commands.dismiss,
		isFileAutocompleteMode,
		mentions.dismiss,
		suggestedCommand,
		onDismissSuggestion,
		showClearMessage,
		resetInput,
		resetUIState,
		onDismissActiveEditor,
		setShowClearMessage,
		focus,
		images.clear,
	]);

	// History navigation
	const handleHistoryNavigation = useCallback(
		(direction: 'up' | 'down') => {
			const history = promptHistory.getHistory();
			if (history.length === 0) return;

			// This value is being recalled, not typed — suppress the auto-show so a
			// recalled `/command` doesn't hijack ↑/↓ from further history navigation.
			inputFromHistoryRef.current = true;

			if (direction === 'up') {
				if (historyIndex === -1) {
					// Save the full current state before starting navigation
					savedDraftRef.current = currentState;
					setOriginalInput(input);
					setHistoryIndex(history.length - 1);
					setInputState(history[history.length - 1]);
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex > 0) {
					const newIndex = historyIndex - 1;
					setHistoryIndex(newIndex);
					setInputState(history[newIndex]);
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex === 0) {
					// At first history item, restore saved draft
					setHistoryIndex(-2);
					setInputState(savedDraftRef.current);
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex === -2) {
					// At draft, cycle back to last history item
					savedDraftRef.current = currentState;
					setHistoryIndex(history.length - 1);
					setInputState(history[history.length - 1]);
					setTextInputKey(prev => prev + 1);
				}
			} else {
				if (historyIndex === -1) {
					// Save draft, go to draft cycling state (visually a no-op)
					savedDraftRef.current = currentState;
					setOriginalInput(input);
					setHistoryIndex(-2);
					setInputState(savedDraftRef.current);
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex === -2) {
					// At draft, cycle to first history item
					savedDraftRef.current = currentState;
					setHistoryIndex(0);
					setInputState(history[0]);
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex >= 0 && historyIndex < history.length - 1) {
					// Move forward in history
					const newIndex = historyIndex + 1;
					setHistoryIndex(newIndex);
					setInputState(history[newIndex]);
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex === history.length - 1) {
					// At last history item, restore saved draft
					setHistoryIndex(-2);
					setInputState(savedDraftRef.current);
					setTextInputKey(prev => prev + 1);
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
		],
	);

	// Any keystroke means the user is composing, not navigating — re-enable the
	// auto-show so editing a recalled command surfaces suggestions again.
	const handleInputChange = useCallback(
		(value: string) => {
			// Nothing reaches the prompt while the shortcuts overlay is open, and a
			// lone `?` in an empty prompt is the overlay toggle (see useInput).
			if (isShortcutsOpenNow() || value === '?') return;
			inputFromHistoryRef.current = false;
			updateInput(value);
		},
		[updateInput, isShortcutsOpenNow],
	);

	const rawInputRef = useRawInput();

	useInput((inputChar, key) => {
		// Ink's App resets the active focus id on every Escape, and TextInput only
		// accepts keys while focused. Every Escape that leaves the composer on
		// screen (dismissing a suggestion, closing the legend or a menu, arming
		// the clear hint, or a no-op on an empty prompt) must reclaim focus, or
		// typing goes dead until something else refocuses it. Queued after Ink's
		// reset in the same batch, so this update wins.
		if (key.escape && !disabled) {
			focus('user-input');
		}

		// `?` in an empty prompt toggles the shortcuts overlay, which swallows
		// every other key until `?` or Escape closes it. ↑/↓ and PgUp/PgDn
		// scroll the legend when it is taller than the terminal allows.
		// Reverse search owns the keyboard: its query is empty at first, so
		// without the guard typing `?` there would open the overlay instead.
		if (
			isComposerKey('toggleShortcuts', inputChar, key) &&
			!disabled &&
			!isReverseSearchMode &&
			(isShortcutsOpenNow() || inputRef.current === '')
		) {
			shortcuts.setOpen(!isShortcutsOpenNow());
			return;
		}
		if (isShortcutsOpenNow()) {
			shortcuts.handleKey(key);
			return;
		}

		// Cancelling in-flight work is owned by the single section-level Escape
		// handler (see InteractiveApp), which fires no matter which component is
		// mounted. Here we only swallow Escape while busy so it doesn't fall
		// through to the clear-input double-press.
		if (key.escape && (isBusy || disabled)) {
			return;
		}

		// Handle shift+tab to toggle development mode (always available)
		if (isComposerKey('toggleMode', inputChar, key) && onToggleMode) {
			onToggleMode();
			return;
		}

		// Handle ctrl+o to toggle compact tool display (always available)
		if (
			isComposerKey('toggleCompactDisplay', inputChar, key) &&
			onToggleCompactDisplay
		) {
			onToggleCompactDisplay();
			return;
		}

		// Handle ctrl+n to toggle expanded reasoning traces (always available;
		// ctrl+g is voice push-to-talk and ctrl+r is reverse history search)
		if (
			isComposerKey('toggleReasoningExpanded', inputChar, key) &&
			onToggleReasoningExpanded
		) {
			onToggleReasoningExpanded();
			return;
		}

		// Handle ctrl+t to collapse/expand the live task list (always available -
		// this sits above the disabled guard so it still works while the agent
		// is working, which is when the task list is on screen)
		if (isComposerKey('toggleTaskList', inputChar, key) && onToggleTaskList) {
			onToggleTaskList();
			return;
		}

		// Delete/Backspace removes the highlighted queued message. Safe to bind
		// bare: removeSelected no-ops unless a queued item is selected and the
		// input is empty, so normal backspace-to-edit still falls through.
		if ((key.delete || key.backspace) && queue.removeSelected()) {
			return;
		}

		// Block all other input when disabled
		if (disabled) {
			return;
		}

		// Reverse prompt search mode (Ctrl+R / bck-i-search)
		if (isReverseSearchMode) {
			const exit = reverseSearch.handleKey(inputChar, key);
			if (exit) {
				if (exit.restore) {
					setInputState(exit.restore);
				}
				setTextInputKey(prev => prev + 1);
				focus('user-input');
			}
			return;
		}

		// Handle ctrl+r to enter reverse prompt search
		if (isComposerKey('reverseSearch', inputChar, key)) {
			reverseSearch.start(currentState);
			commands.hide();
			mentions.dismiss();
			setShowClearMessage(false);
			return;
		}

		// Ctrl+V / Ctrl+X: attach the clipboard image / drop the last one.
		if (isComposerKey('attachClipboardImage', inputChar, key)) {
			images.attachFromClipboard();
			return;
		}
		if (isComposerKey('removeLastImage', inputChar, key)) {
			images.removeLast();
			return;
		}

		// Ctrl+Z / Ctrl+Y: undo / redo the last input edit. State lives in
		// useInputState's undo/redo stacks, which are unused by any key binding,
		// so we surface them here. Both are no-ops on an empty stack.
		//
		// NB: we deliberately do NOT bump textInputKey here. Bumping it remounts
		// <TextInput>, which resets its internal cursor to end-of-value and tears
		// down the whole subtree on every undo/redo. TextInput's own value-sync
		// effect already clamps the cursor to a valid offset when the value
		// changes, so undoing keeps the caret roughly where it was.
		if (isComposerKey('undo', inputChar, key)) {
			undo();
			return;
		}
		if (isComposerKey('redo', inputChar, key)) {
			redo();
			return;
		}

		// Handle special keys
		if (key.escape) {
			handleEscape();
			return;
		}

		// Handle Tab key
		if (key.tab) {
			// Tab in an empty prompt inserts the suggested command, without
			// popping the completion menu over it.
			if (suggestedCommand && input === '') {
				commands.suppressNextAutoShow();
				setInputState({displayValue: suggestedCommand, placeholderContent: {}});
				setTextInputKey(prev => prev + 1);
				onDismissSuggestion?.();
				return;
			}

			// File autocomplete takes priority
			if (isFileAutocompleteMode) {
				void mentions.selectCurrent();
				return;
			}

			// Command completion
			if (commands.handleTab()) {
				return;
			}
		}

		// Space exits file autocomplete mode
		if (inputChar === ' ' && isFileAutocompleteMode) {
			mentions.dismiss();
		}

		// Clear clear message on other input
		if (showClearMessage) {
			setShowClearMessage(false);
			focus('user-input');
		}

		// Newline keys must not submit, select a completion, or recall a queued
		// message. The insertion itself is TextInput's job — it knows the cursor
		// offset, so the newline lands where the caret is. Bail out here before
		// any of the Enter handling below, since ESC+CR and the kitty CSI-u
		// encoding of Shift+Enter both arrive with `key.return` set.
		if (isNewlineKey(inputChar, key, rawInputRef.current)) {
			return;
		}

		// Enter on a command still being typed completes it rather than
		// submitting the fragment (see completeOnEnter).
		if (key.return && !key.shift && commands.completeOnEnter()) {
			return;
		}

		// Handle Enter to submit (fallthrough - if completion handler didn't return)
		if (key.return && !key.shift) {
			if (queue.loadSelected()) {
				return;
			}
			handleSubmit();
			return;
		}

		// Handle navigation
		if (key.upArrow) {
			// In multiline mode (real \n or soft-wrapped visual lines), Up/Down
			// navigate lines — let TextInput handle it
			if (getVisualLineSegments(input, inputWrapWidth).length > 1) return;
			// File autocomplete navigation takes priority
			if (mentions.moveSelection('up')) {
				return;
			}
			// Command completion navigation takes priority over history
			if (commands.moveSelection('up')) {
				return;
			}
			if (queue.navigate('up')) {
				return;
			}
			handleHistoryNavigation('up');
			return;
		}

		if (key.downArrow) {
			// In multiline mode (real \n or soft-wrapped visual lines), Up/Down
			// navigate lines — let TextInput handle it
			if (getVisualLineSegments(input, inputWrapWidth).length > 1) return;
			// File autocomplete navigation takes priority
			if (mentions.moveSelection('down')) {
				return;
			}
			// Command completion navigation takes priority over history
			if (commands.moveSelection('down')) {
				return;
			}
			if (queue.navigate('down')) {
				return;
			}
			handleHistoryNavigation('down');
			return;
		}
	});

	const textColor = disabled || !input ? colors.secondary : colors.primary;

	// When disabled, show minimal UI to avoid cluttering the screen
	if (disabled) {
		return (
			<Box flexDirection="column" paddingY={1} width="100%" marginTop={1}>
				<Text color={colors.secondary}>
					<Spinner type="dots" /> Press Esc to cancel
					{onToggleCompactDisplay && (
						<Text>
							{' '}
							· ctrl-o {compactToolDisplay ? 'expand' : 'compact'}{' '}
							{isNarrow ? '' : 'tool results'}
						</Text>
					)}
				</Text>
				<DevelopmentModeIndicator
					developmentMode={developmentMode}
					colors={colors}
					contextPercentUsed={contextPercentUsed ?? null}
					contextSource={contextSource ?? null}
					sessionName={sessionName}
					tune={tune}
					currentModel={currentModel}
					taskInfo={taskInfo}
					isSaving={isSaving}
					voice={voice}
				/>
			</Box>
		);
	}

	return (
		<>
			<Box
				width={actualWidth}
				alignItems={centered ? 'center' : 'flex-start'}
				flexDirection="column"
			>
				{isBashMode && (
					<Box width={promptWidth}>
						<Text color={colors.tool} bold>
							Bash mode
						</Text>
					</Box>
				)}
				{showShortcuts && (
					<ShortcutsOverlay width={promptWidth} view={shortcuts.view} />
				)}
				<Box
					display={showShortcuts ? 'none' : 'flex'}
					flexDirection="column"
					marginTop={1}
					width={promptWidth}
					paddingX={1}
					paddingY={0}
					borderStyle="round"
					borderColor={isBashMode ? colors.tool : colors.primary}
				>
					{/* Input row */}
					{isReverseSearchMode ? (
						<ReverseSearchPrompt
							query={reverseSearch.query}
							match={reverseSearch.match}
							matchColor={textColor}
						/>
					) : (
						<Box>
							{input.length === 0 && (
								<Text color={isBashMode ? colors.tool : textColor}>{'>'} </Text>
							)}
							<TextInput
								ref={textInputRef}
								key={textInputKey}
								value={input}
								onChange={handleInputChange}
								onEdgeArrow={handleHistoryNavigation}
								onSubmit={handleSubmit}
								onEnter={handleSubmit}
								placeholder={
									suggestedCommand
										? `Try ${suggestedCommand} · Tab to insert · Esc to dismiss`
										: 'Ask anything...'
								}
								focus={effectiveFocus}
								wrapWidth={inputWrapWidth}
								handleEnter={false}
							/>
						</Box>
					)}

					{showClearMessage && (
						<Text color={colors.secondary}>Press escape again to clear</Text>
					)}

					{commands.isOpen && commands.items.length > 0 && (
						<CommandCompletionList
							completions={commands.items}
							selectedIndex={commands.selectedIndex}
						/>
					)}
					{isFileAutocompleteMode && mentions.completions.length > 0 && (
						<FileMentionList
							completions={mentions.completions}
							selectedIndex={mentions.selectedIndex}
						/>
					)}
					{queuedMessages.length > 0 && (
						<QueuedMessageList
							messages={queuedMessages}
							selectedIndex={queue.selectedIndex}
							promptWidth={promptWidth}
							truncate={truncate}
						/>
					)}
					{isBusy && (
						<Box marginTop={1}>
							<Text color={colors.secondary}>
								<Spinner type="dots" /> Press Esc to cancel
								{onToggleCompactDisplay && (
									<Text>
										{' '}
										· ctrl-o {compactToolDisplay ? 'expand' : 'compact'}{' '}
										{isNarrow ? '' : 'tool results'}
									</Text>
								)}
							</Text>
						</Box>
					)}
				</Box>
			</Box>

			{/* Part of the composer, so it hides with the input box. */}
			{!showShortcuts && attachments.length > 0 && (
				<AttachmentPills attachments={attachments} />
			)}
			{/* Development mode indicator - always visible. The indent puts it one
			step to the right of the box's left border, so it aligns cleanly under
			the input box content whether the box is centred or flush left. */}
			<Box marginLeft={indicatorIndent}>
				<DevelopmentModeIndicator
					// Must match the wrapper's marginLeft: the indicator budgets its
					// segments against the width left after this indent, and
					// overflowing it lets Ink cut the row mid-word.
					indentColumns={indicatorIndent}
					developmentMode={developmentMode}
					colors={colors}
					contextPercentUsed={contextPercentUsed ?? null}
					contextSource={contextSource ?? null}
					sessionName={sessionName}
					tune={tune}
					currentModel={currentModel}
					activeEditor={activeEditor}
					taskInfo={taskInfo}
					isSaving={isSaving}
					voice={voice}
				/>
			</Box>
		</>
	);
}
