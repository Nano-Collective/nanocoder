import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
	PASTE_CHUNK_BASE_WINDOW_MS,
	PASTE_CHUNK_MAX_WINDOW_MS,
	PASTE_LARGE_CONTENT_THRESHOLD_CHARS,
	PASTE_RAPID_DETECTION_MS,
} from '@/constants';
import {InputState, PlaceholderType} from '../types/hooks';
import {handleAtomicDeletion} from '../utils/atomic-deletion';
import {PasteDetector} from '../utils/paste-detection';
import {handlePaste, resizePasteDisplayText} from '../utils/paste-utils';
import {findPlaceholderOccurrences} from '../utils/placeholders';

// Scales the paste window size based on content length.
// Prevents truncation on slow terminals while keeping small pastes snappy
function getDynamicPasteWindow(contentLength: number): number {
	// Add ~1ms buffer per 10 chars, capped at max window
	const dynamicExtension = Math.floor(contentLength / 10);
	return Math.min(
		PASTE_CHUNK_BASE_WINDOW_MS + dynamicExtension,
		PASTE_CHUNK_MAX_WINDOW_MS,
	);
}

// Helper functions
function createEmptyInputState(): InputState {
	return {
		displayValue: '',
		placeholderContent: {},
	};
}

export function useInputState() {
	// Core state following the spec
	const [currentState, setCurrentState] = useState<InputState>(
		createEmptyInputState(),
	);

	// Mirrors currentState but updates synchronously, so a handler that fires
	// before React re-renders (e.g. a keystroke landing right after a paste)
	// can still read the true latest state instead of the stale one closed
	// over at the last render. See applyState.
	const currentStateRef = useRef(currentState);

	const [undoStack, setUndoStack] = useState<InputState[]>([]);
	const [redoStack, setRedoStack] = useState<InputState[]>([]);

	// Legacy compatibility - these are derived from currentState
	const [historyIndex, setHistoryIndex] = useState(-1);
	const [_hasLargeContent, setHasLargeContent] = useState(false);
	const [originalInput, setOriginalInput] = useState('');

	// Paste detection
	const pasteDetectorRef = useRef(new PasteDetector());
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

	// Track recent paste for chunked paste handling (VS Code terminal issue)
	const lastPasteTimeRef = useRef<number>(0);
	const lastPasteIdRef = useRef<string | null>(null);

	// The displayValue insertPaste last committed, consumed (one-shot) by the
	// very next updateInput call. A bracketed paste and the keystroke right
	// after it can both fire before React re-renders, so that keystroke's
	// onChange is still built from the pre-paste value; this lets updateInput
	// recognize that specific race and recover instead of clobbering the
	// paste. Scoped to insertPaste only (not a generic staleness check) so it
	// can't misfire on unrelated state transitions.
	const lastPasteCommitRef = useRef<string | null>(null);

	// Cached line count for performance
	const [cachedLineCount, setCachedLineCount] = useState(1);

	// Commits a new state to both the ref (immediately) and React state.
	const applyState = useCallback((newState: InputState) => {
		currentStateRef.current = newState;
		setCurrentState(newState);
	}, []);

	// Helper to push current state to undo stack
	const pushToUndoStack = useCallback(
		(newState: InputState) => {
			// Snapshot before applyState mutates the ref - setUndoStack's updater
			// runs at flush time, so reading the ref lazily inside it would see
			// whatever applyState already wrote below, not the true "previous" state.
			const previousState = currentStateRef.current;
			setUndoStack(prev => [...prev, previousState]);
			setRedoStack([]); // Clear redo stack on new action
			applyState(newState);
		},
		[applyState],
	);

	// Update input with paste detection and atomic deletion
	const updateInput = useCallback(
		(newInput: string) => {
			// One-shot: only the very next updateInput call after a paste should
			// ever see this, regardless of whether it ends up using it below.
			const pendingPasteValue = lastPasteCommitRef.current;
			lastPasteCommitRef.current = null;

			// TextInput builds `newInput` by editing the value it last rendered
			// with (`currentState`, closed over below). If a bracketed paste
			// landed after that render but before this call, that render-time
			// value is stale and `newInput` doesn't include the pasted
			// placeholder. Detect that specific case - the latest committed
			// state is exactly what insertPaste produced, and this edit is a
			// pure append onto the stale value - and replay the typed suffix
			// onto the real latest state instead of letting it clobber the paste.
			const latestState = currentStateRef.current;
			let effectiveState = currentState;
			let effectiveInput = newInput;
			if (
				pendingPasteValue !== null &&
				pendingPasteValue === latestState.displayValue &&
				currentState.displayValue !== latestState.displayValue &&
				newInput.startsWith(currentState.displayValue)
			) {
				effectiveInput =
					latestState.displayValue +
					newInput.slice(currentState.displayValue.length);
				effectiveState = latestState;
			}

			// First, check for atomic deletion (placeholder removal)
			const atomicDeletionResult = handleAtomicDeletion(
				effectiveState,
				effectiveInput,
			);
			if (atomicDeletionResult) {
				// Atomic deletion occurred - apply it
				pushToUndoStack(atomicDeletionResult);
				return;
			}

			const now = Date.now();
			const timeSinceLastPaste = now - lastPasteTimeRef.current;

			// Check if this might be a continuation of a recent paste (chunked paste in VS Code)
			const existingPlaceholder = lastPasteIdRef.current
				? effectiveState.placeholderContent[lastPasteIdRef.current]
				: null;
			const dynamicWindow = existingPlaceholder
				? getDynamicPasteWindow(existingPlaceholder.content.length)
				: PASTE_CHUNK_BASE_WINDOW_MS;

			if (
				lastPasteIdRef.current &&
				timeSinceLastPaste < dynamicWindow &&
				existingPlaceholder
			) {
				// This looks like a chunked paste continuation
				// Extract the new text that was added (should be at the end)
				const placeholder =
					effectiveState.placeholderContent[lastPasteIdRef.current];
				const expectedLength = effectiveState.displayValue.length;
				const addedChunk = effectiveInput.slice(expectedLength);

				if (
					addedChunk.length > 0 &&
					placeholder.type === PlaceholderType.PASTE
				) {
					// Merge the new chunk into the existing paste placeholder
					const updatedContent = placeholder.content + addedChunk;
					const oldPlaceholder = placeholder.displayText;
					const newPlaceholder = resizePasteDisplayText(
						oldPlaceholder,
						updatedContent.length,
					);

					const updatedPlaceholderContent = {
						...effectiveState.placeholderContent,
						[lastPasteIdRef.current]: {
							...placeholder,
							content: updatedContent,
							originalSize: updatedContent.length,
							displayText: newPlaceholder,
						},
					};

					// Replace old placeholder with updated one in display value
					const newDisplayValue = effectiveState.displayValue.replaceAll(
						oldPlaceholder,
						newPlaceholder,
					);

					pushToUndoStack({
						displayValue: newDisplayValue,
						placeholderContent: updatedPlaceholderContent,
					});

					// Update paste detector to the new display value
					pasteDetectorRef.current.updateState(newDisplayValue);
					lastPasteTimeRef.current = now; // Extend the window
					return;
				}
			}

			// Then detect if this might be a paste
			const detection = pasteDetectorRef.current.detectPaste(effectiveInput);

			if (detection.isPaste && detection.addedText.length > 0) {
				// If we have an active paste within a short window (even if state hasn't fully updated),
				// treat this as a continuation to prevent duplicate placeholders
				const isVeryRecentPaste = timeSinceLastPaste < PASTE_RAPID_DETECTION_MS;

				const activePasteId = lastPasteIdRef.current;
				const activePlaceholder = activePasteId
					? effectiveState.placeholderContent[activePasteId]
					: null;
				const activeWindow = activePlaceholder
					? getDynamicPasteWindow(activePlaceholder.content.length)
					: PASTE_CHUNK_BASE_WINDOW_MS;

				if (
					activePasteId &&
					(isVeryRecentPaste ||
						(timeSinceLastPaste < activeWindow && activePlaceholder))
				) {
					// If we don't have the placeholder in state yet, just update detector and skip
					// This happens when multiple detections fire before React updates state
					const placeholder = effectiveState.placeholderContent[activePasteId];
					if (!placeholder) {
						// Skip duplicate early detection
						pasteDetectorRef.current.updateState(effectiveInput);
						return;
					}

					// Treat as chunked continuation
					if (placeholder.type === PlaceholderType.PASTE) {
						const updatedContent = placeholder.content + detection.addedText;
						const oldPlaceholder = placeholder.displayText;
						const newPlaceholder = resizePasteDisplayText(
							oldPlaceholder,
							updatedContent.length,
						);

						const updatedPlaceholderContent = {
							...effectiveState.placeholderContent,
							[activePasteId]: {
								...placeholder,
								content: updatedContent,
								originalSize: updatedContent.length,
								displayText: newPlaceholder,
							},
						};

						const newDisplayValue = effectiveState.displayValue.replaceAll(
							oldPlaceholder,
							newPlaceholder,
						);

						pushToUndoStack({
							displayValue: newDisplayValue,
							placeholderContent: updatedPlaceholderContent,
						});

						pasteDetectorRef.current.updateState(newDisplayValue);
						lastPasteTimeRef.current = now;
						return;
					}
				}

				// Try to handle as paste (new paste)
				const pasteResult = handlePaste(
					detection.addedText,
					effectiveState.displayValue,
					effectiveState.placeholderContent,
					detection.method as 'rate' | 'size' | 'multiline',
				);

				if (pasteResult) {
					// Large paste detected - create placeholder
					pushToUndoStack(pasteResult);
					// Update paste detector state to match the new display value (with placeholder)
					// This prevents detection confusion on subsequent pastes
					pasteDetectorRef.current.updateState(pasteResult.displayValue);

					// Track this paste for potential chunked continuation
					const pasteId = Object.keys(pasteResult.placeholderContent).find(
						id =>
							!effectiveState.placeholderContent[id] &&
							pasteResult.placeholderContent[id].type === PlaceholderType.PASTE,
					);
					if (pasteId) {
						lastPasteIdRef.current = pasteId;
						lastPasteTimeRef.current = now;
					}
				} else {
					// Small paste - treat as normal input
					pushToUndoStack({
						displayValue: effectiveInput,
						placeholderContent: effectiveState.placeholderContent,
					});
				}
			} else {
				// Normal typing
				pushToUndoStack({
					displayValue: effectiveInput,
					placeholderContent: effectiveState.placeholderContent,
				});
			}

			// Update derived state
			const immediateLineCount = Math.max(
				1,
				effectiveInput.split(/\r\n|\r|\n/).length,
			);
			setCachedLineCount(immediateLineCount);

			// Clear any previous debounce timer
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}

			debounceTimerRef.current = setTimeout(() => {
				setHasLargeContent(
					effectiveInput.length > PASTE_LARGE_CONTENT_THRESHOLD_CHARS,
				);
			}, 50);
		},
		[currentState, pushToUndoStack],
	);

	// Insert a paste the terminal told us about (bracketed paste, DECSET
	// 2004). This bypasses updateInput's heuristics entirely: the payload
	// never reached the keypress parser, so there is nothing to guess at
	// and no risk of a pasted newline having submitted the prompt first.
	// The text lands at the end of the input rather than at the cursor —
	// the payload arrives out of band, so the cursor offset TextInput owns
	// isn't part of the event. Callers remount TextInput afterwards so the
	// cursor follows the appended text.
	const insertPaste = useCallback(
		(pastedText: string) => {
			if (!pastedText) {
				return;
			}

			// Read the ref rather than the closed-over currentState: a bracketed
			// paste can arrive right after another update (e.g. a fast double
			// paste) that this closure hasn't seen a re-render for yet.
			const latestState = currentStateRef.current;

			const pasteResult = handlePaste(
				pastedText,
				latestState.displayValue,
				latestState.placeholderContent,
				'bracketed',
			);

			if (pasteResult) {
				// Multi-line or over the threshold: collapsed to a placeholder.
				pushToUndoStack(pasteResult);
				pasteDetectorRef.current.updateState(pasteResult.displayValue);
				lastPasteCommitRef.current = pasteResult.displayValue;
				return;
			}

			// Short single-line paste: insert it literally.
			const newDisplayValue = latestState.displayValue + pastedText;
			pushToUndoStack({
				displayValue: newDisplayValue,
				placeholderContent: latestState.placeholderContent,
			});
			pasteDetectorRef.current.updateState(newDisplayValue);
			lastPasteCommitRef.current = newDisplayValue;
		},
		[pushToUndoStack],
	);

	// Undo function (Ctrl+_)
	const undo = useCallback(() => {
		if (undoStack.length > 0) {
			const previousState = undoStack[undoStack.length - 1];
			const newUndoStack = undoStack.slice(0, -1);
			const stateBeforeUndo = currentStateRef.current;

			setRedoStack(prev => [...prev, stateBeforeUndo]);
			setUndoStack(newUndoStack);
			applyState(previousState);

			// Update paste detector state
			pasteDetectorRef.current.updateState(previousState.displayValue);
		}
	}, [undoStack, applyState]);

	// Redo function (Ctrl+Y)
	const redo = useCallback(() => {
		if (redoStack.length > 0) {
			const nextState = redoStack[redoStack.length - 1];
			const newRedoStack = redoStack.slice(0, -1);
			const stateBeforeRedo = currentStateRef.current;

			setUndoStack(prev => [...prev, stateBeforeRedo]);
			setRedoStack(newRedoStack);
			applyState(nextState);

			// Update paste detector state
			pasteDetectorRef.current.updateState(nextState.displayValue);
		}
	}, [redoStack, applyState]);

	// Delete placeholder atomically
	const deletePlaceholder = useCallback(
		(placeholderId: string) => {
			if (!currentState.placeholderContent[placeholderId]) {
				return;
			}

			// Locate every occurrence by its display text rather than rebuilding a
			// pattern from the id: ids are namespaced keys, not display labels.
			const occurrences = findPlaceholderOccurrences(
				currentState.displayValue,
				currentState.placeholderContent,
			).filter(candidate => candidate.id === placeholderId);

			let newDisplayValue = currentState.displayValue;
			for (let i = occurrences.length - 1; i >= 0; i--) {
				const {start, end} = occurrences[i];
				newDisplayValue =
					newDisplayValue.slice(0, start) + newDisplayValue.slice(end);
			}

			const newPlaceholderContent = {...currentState.placeholderContent};
			delete newPlaceholderContent[placeholderId];

			pushToUndoStack({
				displayValue: newDisplayValue,
				placeholderContent: newPlaceholderContent,
			});
		},
		[currentState, pushToUndoStack],
	);

	// Reset all state
	const resetInput = useCallback(() => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}

		applyState(createEmptyInputState());
		setUndoStack([]);
		setRedoStack([]);
		setHasLargeContent(false);
		setOriginalInput('');
		setHistoryIndex(-1);
		setCachedLineCount(1);
		pasteDetectorRef.current.reset();
		lastPasteTimeRef.current = 0;
		lastPasteIdRef.current = null;
		lastPasteCommitRef.current = null;
	}, [applyState]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
		};
	}, []);

	// Set full InputState (for history navigation)
	const setInputState = useCallback(
		(newState: InputState) => {
			applyState(newState);
			pasteDetectorRef.current.updateState(newState.displayValue);
		},
		[applyState],
	);

	// Legacy setters for compatibility
	const setInput = useCallback(
		(newInput: string) => {
			applyState({
				...currentStateRef.current,
				displayValue: newInput,
			});
			pasteDetectorRef.current.updateState(newInput);
		},
		[applyState],
	);

	// Compute legacy pastedContent for backward compatibility
	const legacyPastedContent = useMemo(() => {
		const pastedContent: Record<string, string> = {};
		Object.entries(currentState.placeholderContent).forEach(([id, content]) => {
			if (content.type === PlaceholderType.PASTE) {
				pastedContent[id] = content.content;
			}
		});
		return pastedContent;
	}, [currentState.placeholderContent]);

	return useMemo(
		() => ({
			// New spec-compliant interface
			currentState,
			// Always up to date, even mid-batch before a re-render commits.
			// Consumers that read state in direct response to a raw stdin event
			// (e.g. submitting on Enter) should prefer this over `currentState`
			// to avoid acting on a value a just-applied paste has superseded.
			currentStateRef,
			undoStack,
			redoStack,
			undo,
			redo,
			deletePlaceholder,
			setInputState,
			insertPaste,

			// Legacy interface for compatibility
			input: currentState.displayValue,
			originalInput,
			historyIndex,
			setInput,
			setOriginalInput,
			setHistoryIndex,
			updateInput,
			resetInput,
			cachedLineCount,
			// Computed legacy property for backward compatibility
			pastedContent: legacyPastedContent,
		}),
		[
			currentState,
			undoStack,
			redoStack,
			undo,
			redo,
			deletePlaceholder,
			setInputState,
			insertPaste,
			originalInput,
			historyIndex,
			setInput,
			updateInput,
			resetInput,
			cachedLineCount,
			legacyPastedContent,
		],
	);
}
