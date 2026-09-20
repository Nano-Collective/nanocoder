import type {InputState} from '../types/hooks';

/**
 * Detect if a text change represents a deletion that should be atomic
 * Returns the modified InputState if atomic deletion occurred, null otherwise
 */
export function handleAtomicDeletion(
	previousState: InputState,
	newText: string,
): InputState | null {
	const previousText = previousState.displayValue;

	// Only handle deletions (text getting shorter)
	if (newText.length >= previousText.length) {
		return null;
	}

	// Find what was deleted
	const deletedChars = previousText.length - newText.length;

	// Find where the deletion occurred
	let deletionStart = -1;
	for (let i = 0; i < Math.min(previousText.length, newText.length); i++) {
		if (previousText[i] !== newText[i]) {
			deletionStart = i;
			break;
		}
	}

	// If no difference found in common part, deletion was at the end
	if (deletionStart === -1) {
		deletionStart = newText.length;
	}

	// Check if any placeholder was affected by this deletion
	const placeholderRegex = /\[Paste #(\d+): \d+ chars\]/g;
	let match;

	while ((match = placeholderRegex.exec(previousText)) !== null) {
		const placeholderStart = match.index;
		const placeholderEnd = placeholderStart + match[0].length;
		const placeholderId = match[1];

		// Check if deletion overlaps with this placeholder
		const deletionEnd = deletionStart + deletedChars;

		if (
			(deletionStart >= placeholderStart && deletionStart < placeholderEnd) ||
			(deletionEnd > placeholderStart && deletionEnd <= placeholderEnd) ||
			(deletionStart <= placeholderStart && deletionEnd >= placeholderEnd)
		) {
			// Deletion affects this placeholder - remove it atomically
			const newDisplayValue = previousText.replace(match[0], '');
			const newPlaceholderContent = {...previousState.placeholderContent};
			delete newPlaceholderContent[placeholderId];

			return {
				displayValue: newDisplayValue,
				placeholderContent: newPlaceholderContent,
			};
		}
	}

	return null;
}

/**
 * Find placeholder at cursor position
 * Returns placeholder ID if cursor is within a placeholder, null otherwise
 */
export function findPlaceholderAtPosition(
	text: string,
	position: number,
): string | null {
	const placeholderRegex = /\[Paste #(\d+): \d+ chars\]/g;
	let match;

	while ((match = placeholderRegex.exec(text)) !== null) {
		const placeholderStart = match.index;
		const placeholderEnd = placeholderStart + match[0].length;

		if (position >= placeholderStart && position <= placeholderEnd) {
			return match[1]; // Return the placeholder ID
		}
	}

	return null;
}

/**
 * Check if a deletion would partially affect a placeholder
 * Used to prevent partial placeholder deletions
 */
export function wouldPartiallyDeletePlaceholder(
	text: string,
	deletionStart: number,
	deletionLength: number,
): boolean {
	const placeholderRegex = /\[Paste #(\d+): \d+ chars\]/g;
	let match;

	while ((match = placeholderRegex.exec(text)) !== null) {
		const placeholderStart = match.index;
		const placeholderEnd = placeholderStart + match[0].length;
		const deletionEnd = deletionStart + deletionLength;

		// Check for overlap
		const overlapsStart =
			deletionStart >= placeholderStart && deletionStart < placeholderEnd;
		const overlapsEnd =
			deletionEnd > placeholderStart && deletionEnd <= placeholderEnd;
		const spansPast =
			deletionStart < placeholderStart && deletionEnd > placeholderStart;
		const spansOver =
			deletionStart < placeholderEnd && deletionEnd > placeholderEnd;

		const hasOverlap = overlapsStart || overlapsEnd || spansPast || spansOver;
		const completeOverlap =
			deletionStart <= placeholderStart && deletionEnd >= placeholderEnd;

		if (hasOverlap && !completeOverlap) {
			return true;
		}
	}

	return false;
}
