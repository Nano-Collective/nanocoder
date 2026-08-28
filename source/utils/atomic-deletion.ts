import type {InputState, PlaceholderContent} from '../types/hooks';
import {findPlaceholderOccurrences} from './placeholders';

/**
 * Returns true when two half-open ranges, [start, end), share any characters.
 */
function rangesOverlap(
	firstStart: number,
	firstEnd: number,
	secondStart: number,
	secondEnd: number,
): boolean {
	return firstStart < secondEnd && firstEnd > secondStart;
}

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

	const deletionEnd = deletionStart + deletedChars;

	// Check if any placeholder was affected by this deletion
	for (const occurrence of findPlaceholderOccurrences(
		previousText,
		previousState.placeholderContent,
	)) {
		const {start, end} = occurrence;

		if (rangesOverlap(deletionStart, deletionEnd, start, end)) {
			// Deletion affects this placeholder - remove it atomically
			const newDisplayValue =
				previousText.slice(0, start) + previousText.slice(end);
			const newPlaceholderContent = {...previousState.placeholderContent};
			delete newPlaceholderContent[occurrence.id];

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
	placeholderContent: Record<string, PlaceholderContent>,
): string | null {
	for (const {id, start, end} of findPlaceholderOccurrences(
		text,
		placeholderContent,
	)) {
		if (position > start && position <= end) {
			return id;
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
	placeholderContent: Record<string, PlaceholderContent>,
): boolean {
	const deletionEnd = deletionStart + deletionLength;

	for (const {start, end} of findPlaceholderOccurrences(
		text,
		placeholderContent,
	)) {
		const hasOverlap = rangesOverlap(deletionStart, deletionEnd, start, end);
		const completeOverlap = deletionStart <= start && deletionEnd >= end;

		if (hasOverlap && !completeOverlap) {
			return true;
		}
	}

	return false;
}
