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
import {handlePaste} from '../utils/paste-utils';

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

	// Helper to push current state to undo stack
	const pushToUndoStack = useCallback(
		(newState: InputState) => {
			setUndoStack(prev => [...prev, currentState]);
			setRedoStack([]); // Clear redo stack on new action
			setCurrentState(newState);
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
					const newPlaceholder = `[Paste #${lastPasteIdRef.current}: ${updatedContent.length} chars]`;

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
					const newDisplayValue = currentState.displayValue.replace(
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
						const newPlaceholder = `[Paste #${activePasteId}: ${updatedContent.length} chars]`;

						const updatedPlaceholderContent = {
							...currentState.placeholderContent,
							[activePasteId]: {
								...placeholder,
								content: updatedContent,
								originalSize: updatedContent.length,
								displayText: newPlaceholder,
							},
						};

						const newDisplayValue = currentState.displayValue.replace(
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

	// Undo function (Ctrl+_)
	const undo = useCallback(() => {
		if (undoStack.length > 0) {
			const previousState = undoStack[undoStack.length - 1];
			const newUndoStack = undoStack.slice(0, -1);

			setRedoStack(prev => [...prev, currentState]);
			setUndoStack(newUndoStack);
			setCurrentState(previousState);

			// Update paste detector state
			pasteDetectorRef.current.updateState(previousState.displayValue);
		}
	}, [undoStack, currentState]);

	// Redo function (Ctrl+Y)
	const redo = useCallback(() => {
		if (redoStack.length > 0) {
			const nextState = redoStack[redoStack.length - 1];
			const newRedoStack = redoStack.slice(0, -1);

			setUndoStack(prev => [...prev, currentState]);
			setRedoStack(newRedoStack);
			setCurrentState(nextState);

			// Update paste detector state
			pasteDetectorRef.current.updateState(nextState.displayValue);
		}
	}, [redoStack, currentState]);

	// Delete placeholder atomically
	const deletePlaceholder = useCallback(
		(placeholderId: string) => {
			// Sanitize placeholderId to ensure it only contains safe characters
			const sanitizedPlaceholderId = placeholderId.replace(
				/[^a-zA-Z0-9_-]/g,
				'',
			);
			const placeholderPattern = `[Paste #${sanitizedPlaceholderId}: \\d+ chars]`;
			/* nosemgrep */
			const regex = new RegExp(
				placeholderPattern.replace(/[[\]]/g, '\\$&'),
				'g',
			);

			const newDisplayValue = currentState.displayValue.replace(regex, '');
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
