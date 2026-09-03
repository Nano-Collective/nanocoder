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

	const [undoStack, setUndoStack] = useState<InputState[]>([]);
	const [redoStack, setRedoStack] = useState<InputState[]>([]);

	// Refs mirror the three state values that undo/redo/pushToUndoStack read.
	// Callbacks hold refs via closures (empty deps) so that rapid consecutive
	// calls within a single stdin batch — before React re-renders — always see
	// the latest values, avoiding the stale-closure class of bug.
	const currentStateRef = useRef(currentState);
	const undoStackRef = useRef(undoStack);
	const redoStackRef = useRef(redoStack);

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

	// Keep refs in sync with React state so callbacks (which close over refs
	// via empty deps) always see the latest values.  This avoids stale closures
	// when multiple events arrive in the same stdin batch (Ink doesn't re-render
	// between events).
	useEffect(() => {
		currentStateRef.current = currentState;
	}, [currentState]);
	useEffect(() => {
		undoStackRef.current = undoStack;
	}, [undoStack]);
	useEffect(() => {
		redoStackRef.current = redoStack;
	}, [redoStack]);

	// Cached line count for performance
	const [cachedLineCount, setCachedLineCount] = useState(1);

	// Cap the undo stack so a long composition can't grow it unbounded.
	// Every keystroke/paste pushes one entry, and each entry holds a full
	// InputState — without a ceiling the array (and its copies) grows
	// linearly with input length. 100 steps is far beyond any realistic
	// undo depth while keeping memory bounded.
	const MAX_UNDO_STACK = 100;

	// Helper to push current state to undo stack.
	const pushToUndoStack = useCallback(
		(newState: InputState) => {
			setUndoStack(prev => {
				if (prev.length >= MAX_UNDO_STACK) {
					return [...prev.slice(-(MAX_UNDO_STACK - 1)), currentState];
				}
				return [...prev, currentState];
			});
			setRedoStack([]); // Clear redo stack on new action
			setCurrentState(newState);
			// Keep the ref in lockstep so undo/redo called in the same tick
			// capture the latest value.
			currentStateRef.current = newState;
		},
		[currentState],
	);

	// Update input with paste detection and atomic deletion
	const updateInput = useCallback(
		(newInput: string) => {
			// First, check for atomic deletion (placeholder removal)
			const atomicDeletionResult = handleAtomicDeletion(currentState, newInput);
			if (atomicDeletionResult) {
				// Atomic deletion occurred - apply it
				pushToUndoStack(atomicDeletionResult);
				return;
			}

			const now = Date.now();
			const timeSinceLastPaste = now - lastPasteTimeRef.current;

			// Check if this might be a continuation of a recent paste (chunked paste in VS Code)
			const existingPlaceholder = lastPasteIdRef.current
				? currentState.placeholderContent[lastPasteIdRef.current]
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
					currentState.placeholderContent[lastPasteIdRef.current];
				const expectedLength = currentState.displayValue.length;
				const addedChunk = newInput.slice(expectedLength);

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
						...currentState.placeholderContent,
						[lastPasteIdRef.current]: {
							...placeholder,
							content: updatedContent,
							originalSize: updatedContent.length,
							displayText: newPlaceholder,
						},
					};

					// Replace old placeholder with updated one in display value
					const newDisplayValue = currentState.displayValue.replaceAll(
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
			const detection = pasteDetectorRef.current.detectPaste(newInput);

			if (detection.isPaste && detection.addedText.length > 0) {
				// If we have an active paste within a short window (even if state hasn't fully updated),
				// treat this as a continuation to prevent duplicate placeholders
				const isVeryRecentPaste = timeSinceLastPaste < PASTE_RAPID_DETECTION_MS;

				const activePasteId = lastPasteIdRef.current;
				const activePlaceholder = activePasteId
					? currentState.placeholderContent[activePasteId]
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
					const placeholder = currentState.placeholderContent[activePasteId];
					if (!placeholder) {
						// Skip duplicate early detection
						pasteDetectorRef.current.updateState(newInput);
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
							...currentState.placeholderContent,
							[activePasteId]: {
								...placeholder,
								content: updatedContent,
								originalSize: updatedContent.length,
								displayText: newPlaceholder,
							},
						};

						const newDisplayValue = currentState.displayValue.replaceAll(
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
					currentState.displayValue,
					currentState.placeholderContent,
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
							!currentState.placeholderContent[id] &&
							pasteResult.placeholderContent[id].type === PlaceholderType.PASTE,
					);
					if (pasteId) {
						lastPasteIdRef.current = pasteId;
						lastPasteTimeRef.current = now;
					}
				} else {
					// Small paste - treat as normal input
					pushToUndoStack({
						displayValue: newInput,
						placeholderContent: currentState.placeholderContent,
					});
				}
			} else {
				// Normal typing
				pushToUndoStack({
					displayValue: newInput,
					placeholderContent: currentState.placeholderContent,
				});
			}

			// Update derived state
			const immediateLineCount = Math.max(
				1,
				newInput.split(/\r\n|\r|\n/).length,
			);
			setCachedLineCount(immediateLineCount);

			// Clear any previous debounce timer
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}

			debounceTimerRef.current = setTimeout(() => {
				setHasLargeContent(
					newInput.length > PASTE_LARGE_CONTENT_THRESHOLD_CHARS,
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

			const pasteResult = handlePaste(
				pastedText,
				currentState.displayValue,
				currentState.placeholderContent,
				'bracketed',
			);

			if (pasteResult) {
				// Multi-line or over the threshold: collapsed to a placeholder.
				pushToUndoStack(pasteResult);
				pasteDetectorRef.current.updateState(pasteResult.displayValue);
				return;
			}

			// Short single-line paste: insert it literally.
			const newDisplayValue = currentState.displayValue + pastedText;
			pushToUndoStack({
				displayValue: newDisplayValue,
				placeholderContent: currentState.placeholderContent,
			});
			pasteDetectorRef.current.updateState(newDisplayValue);
		},
		[currentState, pushToUndoStack],
	);

	// Undo function (Ctrl+_).
	// Reads from refs via empty deps so rapid consecutive calls (e.g. two Ctrl+Z
	// events in the same stdin batch) each see the latest stack, not the stale
	// closure value from the last render.  Refs are the synchronous source of
	// truth: each call computes the next stacks from refs and writes refs BEFORE
	// scheduling state, so a second call in the same tick sees the first call's
	// result.  No side effects inside functional updaters (React may invoke them
	// more than once).
	const undo = useCallback(() => {
		const stack = undoStackRef.current;
		if (stack.length > 0) {
			const previousState = stack[stack.length - 1];
			const nextUndoStack = stack.slice(0, -1);
			const nextRedoStack = [...redoStackRef.current, currentStateRef.current];

			undoStackRef.current = nextUndoStack;
			redoStackRef.current = nextRedoStack;
			currentStateRef.current = previousState;

			setUndoStack(nextUndoStack);
			setRedoStack(nextRedoStack);
			setCurrentState(previousState);

			// Update paste detector state
			pasteDetectorRef.current.updateState(previousState.displayValue);
		}
	}, []);

	// Redo function (Ctrl+Y). Same ref-as-source-of-truth pattern as undo.
	const redo = useCallback(() => {
		const stack = redoStackRef.current;
		if (stack.length > 0) {
			const nextState = stack[stack.length - 1];
			const nextRedoStack = stack.slice(0, -1);
			const nextUndoStack = [...undoStackRef.current, currentStateRef.current];

			undoStackRef.current = nextUndoStack;
			redoStackRef.current = nextRedoStack;
			currentStateRef.current = nextState;

			setUndoStack(nextUndoStack);
			setRedoStack(nextRedoStack);
			setCurrentState(nextState);

			// Update paste detector state
			pasteDetectorRef.current.updateState(nextState.displayValue);
		}
	}, []);

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

		setCurrentState(createEmptyInputState());
		setUndoStack([]);
		setRedoStack([]);
		setHasLargeContent(false);
		setOriginalInput('');
		setHistoryIndex(-1);
		setCachedLineCount(1);
		pasteDetectorRef.current.reset();
		lastPasteTimeRef.current = 0;
		lastPasteIdRef.current = null;
	}, []);

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
	const setInputState = useCallback((newState: InputState) => {
		setCurrentState(newState);
		pasteDetectorRef.current.updateState(newState.displayValue);
	}, []);

	// Legacy setters for compatibility
	const setInput = useCallback((newInput: string) => {
		setCurrentState(prev => ({
			...prev,
			displayValue: newInput,
		}));
		pasteDetectorRef.current.updateState(newInput);
	}, []);

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
