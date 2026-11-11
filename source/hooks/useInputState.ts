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

// Cap both undo and redo stacks so a long composition can't grow them
// unbounded. Every keystroke/paste pushes one entry, and each entry holds a
// full InputState — without a ceiling the arrays (and their copies) grow
// linearly with input length. 100 steps is far beyond any realistic undo depth
// while keeping memory bounded.
export const MAX_UNDO_STACK = 100;

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

// Length of the common prefix of `a` and `b`, and of the common suffix that
// does not overlap it: together they locate the one region `a` -> `b` changed.
function diffBounds(a: string, b: string): {start: number; suffix: number} {
	let start = 0;
	const max = Math.min(a.length, b.length);
	while (start < max && a[start] === b[start]) start++;
	let suffix = 0;
	while (
		suffix < max - start &&
		a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
	) {
		suffix++;
	}
	return {start, suffix};
}

/**
 * TextInput builds each value it reports from the value it last rendered
 * (plus its own edits since). When something changes the input out of band
 * before the next render - a bracketed paste, an undo - that report is based
 * on a stale value, and committing it as-is erases the change. Replay the
 * edit TextInput made (`base` -> `edited`) onto `latest` instead, for
 * insertions and deletions alike.
 *
 * An edit at the exact spot the out-of-band change inserted text goes after
 * it: that is where the cursor sits once the paste is shown.
 */
export function reconcileStaleEdit(
	base: string,
	edited: string,
	latest: string,
): string {
	if (base === latest) return edited;

	const edit = diffBounds(base, edited);
	const editEnd = base.length - edit.suffix;
	const inserted = edited.slice(edit.start, edited.length - edit.suffix);

	// Where base -> latest changed: base[changeStart, changeEnd) became
	// latest[changeStart, latestChangeEnd).
	const change = diffBounds(base, latest);
	const changeStart = change.start;
	const changeEnd = base.length - change.suffix;
	const latestChangeEnd = latest.length - change.suffix;

	// Map a base offset into latest. `after` decides which side of the
	// out-of-band change an offset right at it lands on.
	const map = (offset: number, after: boolean): number => {
		if (offset < changeStart) return offset;
		if (offset > changeEnd) return offset + latestChangeEnd - changeEnd;
		if (changeStart === changeEnd) {
			return after ? latestChangeEnd : changeStart;
		}
		if (offset === changeStart) return changeStart;
		// At or inside a region the out-of-band change replaced: whatever the
		// edit touched there is gone, so land at its end.
		return latestChangeEnd;
	};

	const start = map(edit.start, true);
	const end = Math.max(start, map(editEnd, false));
	return latest.slice(0, start) + inserted + latest.slice(end);
}

/**
 * The input and its edit history. One value, so every transition replaces
 * all three together and nothing can be updated without the others.
 */
export interface EditorState {
	current: InputState;
	undo: InputState[];
	redo: InputState[];
}

function pushCapped(stack: InputState[], entry: InputState): InputState[] {
	return stack.length >= MAX_UNDO_STACK
		? [...stack.slice(-(MAX_UNDO_STACK - 1)), entry]
		: [...stack, entry];
}

/** An edit: the old input goes on the undo stack and redo is cleared. */
export function applyEdit(state: EditorState, next: InputState): EditorState {
	return {current: next, undo: pushCapped(state.undo, state.current), redo: []};
}

/** Step back one edit. Returns `state` itself when there is nothing to undo. */
export function applyUndo(state: EditorState): EditorState {
	const previous = state.undo.at(-1);
	if (!previous) return state;
	return {
		current: previous,
		undo: state.undo.slice(0, -1),
		redo: pushCapped(state.redo, state.current),
	};
}

/** Re-apply one undone edit. Returns `state` itself when there is none. */
export function applyRedo(state: EditorState): EditorState {
	const next = state.redo.at(-1);
	if (!next) return state;
	return {
		current: next,
		undo: pushCapped(state.undo, state.current),
		redo: state.redo.slice(0, -1),
	};
}

function emptyEditorState(): EditorState {
	return {current: createEmptyInputState(), undo: [], redo: []};
}

export function useInputState() {
	// The editor state lives in one ref, the only source of truth. Callbacks
	// read and write it synchronously, so several events in one stdin batch
	// (Ink doesn't re-render between them) each see the previous one's
	// result. `snapshot` is the copy React renders; commit() is the only
	// writer and updates both together, so they can't drift apart.
	const storeRef = useRef<EditorState>(emptyEditorState());
	const [snapshot, setSnapshot] = useState(storeRef.current);
	const commit = useCallback((next: EditorState) => {
		storeRef.current = next;
		setSnapshot(next);
	}, []);
	const currentState = snapshot.current;
	// Read-only view of the latest input, ahead of a re-render.
	const currentStateRef = useMemo<{readonly current: InputState}>(
		() => ({
			get current() {
				return storeRef.current.current;
			},
		}),
		[],
	);

	// The value TextInput builds its next report from: what it was last
	// rendered with, then each value it has reported since. Written during
	// render, the same way TextInput tracks it, so updateInput can tell when
	// that report is based on a value the input no longer holds.
	const textInputValueRef = useRef(currentState.displayValue);
	textInputValueRef.current = currentState.displayValue;

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

	// Cached line count for performance
	const [cachedLineCount, setCachedLineCount] = useState(1);

	// Record an edit. Reads the previous input from the store at call time, so
	// several edits in one stdin batch each record the right predecessor.
	const pushToUndoStack = useCallback(
		(newState: InputState) => {
			commit(applyEdit(storeRef.current, newState));
		},
		[commit],
	);

	// Update input with paste detection and atomic deletion
	//
	// Reads state from the store (the synchronous source of truth) rather
	// than the closure value so that a burst of updateInput calls within one
	// stdin batch each see the newest committed state (undo/redo fix #4).
	const updateInput = useCallback(
		(reportedInput: string) => {
			const currentState = storeRef.current.current;
			// TextInput's report may be built on a value that a paste (or undo)
			// has since replaced; carry its edit over to the current value.
			const newInput = reconcileStaleEdit(
				textInputValueRef.current,
				reportedInput,
				currentState.displayValue,
			);
			textInputValueRef.current = reportedInput;

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
						updatedContent,
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
							updatedContent,
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
		[pushToUndoStack],
	);

	// Insert a paste the terminal told us about (bracketed paste, DECSET
	// 2004). This bypasses updateInput's heuristics entirely: the payload
	// never reached the keypress parser, so there is nothing to guess at
	// and no risk of a pasted newline having submitted the prompt first.
	//
	// When `cursorOffset` is supplied (the caller read it off TextInput
	// before the paste fired) the pasted text lands at the caret, not at the
	// end of the value. The function then returns the new caret offset so
	// the caller can place the cursor after the splice. Returns `null` when
	// nothing was inserted (empty payload) or when no cursor was supplied —
	// in the latter case the legacy "append and remount TextInput" path takes
	// over in the caller.
	const insertPaste = useCallback(
		(
			pastedText: string,
			cursorOffset?: number,
		): {cursorOffset: number} | null => {
			if (!pastedText) {
				return null;
			}

			// The ref, not the render-time state: a paste can land in the same
			// stdin batch as keys typed just before it.
			const currentState = storeRef.current.current;
			const pasteResult = handlePaste(
				pastedText,
				currentState.displayValue,
				currentState.placeholderContent,
				'bracketed',
				cursorOffset,
			);

			if (!pasteResult) {
				// Short single-line paste with no cursor supplied — the legacy
				// path: just append. The caller remounts TextInput so the caret
				// jumps to end-of-value.
				const appended = currentState.displayValue + pastedText;
				pushToUndoStack({
					displayValue: appended,
					placeholderContent: currentState.placeholderContent,
				});
				pasteDetectorRef.current.updateState(appended);
				return null;
			}

			pushToUndoStack(pasteResult);
			pasteDetectorRef.current.updateState(pasteResult.displayValue);

			if (cursorOffset === undefined) {
				return null;
			}

			// With a cursor, the caller hands TextInput the pasted value along
			// with the new caret, so TextInput's next report builds on it.
			textInputValueRef.current = pasteResult.displayValue;

			// Place the caret at the end of whatever was spliced in. The delta
			// is the same whether the splice inserted the raw payload (short
			// paste) or a placeholder label (long paste) — we just measure the
			// resulting string.
			const delta =
				pasteResult.displayValue.length - currentState.displayValue.length;
			return {cursorOffset: cursorOffset + delta};
		},
		[pushToUndoStack],
	);

	// Undo (Ctrl+Z) / redo (Ctrl+Y). Both read the store at call time, so two
	// presses in one stdin batch each step once. Both stacks are capped at
	// MAX_UNDO_STACK, so a long undo or redo streak can't grow the other one.
	const undo = useCallback(() => {
		const next = applyUndo(storeRef.current);
		if (next === storeRef.current) return;
		commit(next);
		pasteDetectorRef.current.updateState(next.current.displayValue);
	}, [commit]);

	const redo = useCallback(() => {
		const next = applyRedo(storeRef.current);
		if (next === storeRef.current) return;
		commit(next);
		pasteDetectorRef.current.updateState(next.current.displayValue);
	}, [commit]);

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

		// Through the store, so a key typed before the next render builds on
		// the empty input rather than on what was just submitted.
		commit(emptyEditorState());
		setHasLargeContent(false);
		setOriginalInput('');
		setHistoryIndex(-1);
		setCachedLineCount(1);
		pasteDetectorRef.current.reset();
		lastPasteTimeRef.current = 0;
		lastPasteIdRef.current = null;
	}, [commit]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
		};
	}, []);

	// Replace the input without recording an undo step (history navigation,
	// completions, restored drafts). Through the store like every other
	// writer, so Enter or a key in the same stdin batch sees the new input.
	const setInputState = useCallback(
		(newState: InputState) => {
			commit({...storeRef.current, current: newState});
			pasteDetectorRef.current.updateState(newState.displayValue);
		},
		[commit],
	);

	// Legacy setters for compatibility
	const setInput = useCallback(
		(newInput: string) => {
			const store = storeRef.current;
			commit({...store, current: {...store.current, displayValue: newInput}});
			pasteDetectorRef.current.updateState(newInput);
		},
		[commit],
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
			// Latest state, ahead of a re-render - for reads that can run in the
			// same stdin batch as the edit that changed it (Enter after a paste).
			currentStateRef,
			undoStack: snapshot.undo,
			redoStack: snapshot.redo,
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
			currentStateRef,
			snapshot.undo,
			snapshot.redo,
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
