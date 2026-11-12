import {useCallback, useEffect, useState} from 'react';
import type {QueuedUserMessage} from '@/hooks/useUserMessageQueue';

interface UseQueuedMessageSelectionOptions {
	queuedMessages: QueuedUserMessage[];
	/** The composer's text. The queue is only navigable from an empty prompt. */
	input: string;
	onRemoveQueuedMessage?: (id: string) => void;
	/**
	 * Put a queued message back in the composer for editing. Called before the
	 * message is removed from the queue. Must be stable across renders.
	 */
	onLoadForEditing: (message: QueuedUserMessage) => void;
}

/**
 * Picking a queued message from an empty prompt: ↓ walks into the list, ↑
 * walks back out to the prompt, Enter loads the highlighted message for
 * editing (taking it out of the queue), Delete removes it.
 *
 * `selectedIndex` is -1 while the prompt itself is selected.
 */
export function useQueuedMessageSelection({
	queuedMessages,
	input,
	onRemoveQueuedMessage,
	onLoadForEditing,
}: UseQueuedMessageSelectionOptions) {
	const [selectedIndex, setSelectedIndex] = useState(-1);

	// Keep the selection inside the queue as messages are sent or removed.
	useEffect(() => {
		if (queuedMessages.length === 0) {
			setSelectedIndex(-1);
			return;
		}

		setSelectedIndex(index =>
			index >= queuedMessages.length ? queuedMessages.length - 1 : index,
		);
	}, [queuedMessages.length]);

	/** Back to the prompt (after a submit or queue). */
	const resetSelection = useCallback(() => setSelectedIndex(-1), []);

	/**
	 * Move through the queue. Returns false when the key should fall through
	 * to prompt-history navigation instead.
	 */
	const navigate = useCallback(
		(direction: 'up' | 'down') => {
			if (input.length > 0 || queuedMessages.length === 0) {
				return false;
			}

			if (direction === 'up') {
				// At the input (-1) there's nothing above the queue, so let the press
				// fall through to history navigation. From the first queued item, step
				// back up to the input.
				if (selectedIndex < 0) {
					return false;
				}
				setSelectedIndex(selectedIndex - 1);
				return true;
			}

			// Down enters the queue from the input, then walks toward the last item
			// and stops there (no wrap-around).
			if (selectedIndex >= queuedMessages.length - 1) {
				return selectedIndex >= 0;
			}
			setSelectedIndex(selectedIndex + 1);
			return true;
		},
		[input.length, queuedMessages.length, selectedIndex],
	);

	const hasSelection =
		input.length === 0 &&
		selectedIndex >= 0 &&
		selectedIndex < queuedMessages.length;

	/** Enter: load the highlighted message for editing. False if none. */
	const loadSelected = useCallback(() => {
		if (!hasSelection) {
			return false;
		}

		const queuedMessage = queuedMessages[selectedIndex];
		onLoadForEditing(queuedMessage);
		onRemoveQueuedMessage?.(queuedMessage.id);
		setSelectedIndex(-1);
		return true;
	}, [
		hasSelection,
		selectedIndex,
		queuedMessages,
		onLoadForEditing,
		onRemoveQueuedMessage,
	]);

	/**
	 * Delete / Backspace: remove the highlighted message. Safe to bind bare:
	 * it no-ops (returns false) unless a queued item is selected and the
	 * prompt is empty, so normal backspace-to-edit still falls through.
	 */
	const removeSelected = useCallback(() => {
		if (!hasSelection) {
			return false;
		}

		onRemoveQueuedMessage?.(queuedMessages[selectedIndex].id);
		setSelectedIndex(index =>
			index >= queuedMessages.length - 1 ? queuedMessages.length - 2 : index,
		);
		return true;
	}, [hasSelection, selectedIndex, queuedMessages, onRemoveQueuedMessage]);

	return {
		selectedIndex,
		resetSelection,
		navigate,
		loadSelected,
		removeSelected,
	};
}
