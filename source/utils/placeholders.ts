import type {PlaceholderContent} from '../types/hooks';

export interface PlaceholderOccurrence {
	id: string;
	/** Index of the placeholder's first character in the display value. */
	start: number;
	/** Index just past the placeholder's last character. */
	end: number;
}

/**
 * Locate every placeholder in `text` by scanning for its display text.
 *
 * Each entry claims at most one occurrence, so two placeholders that render
 * identically (the same file mentioned twice) map to distinct positions
 * instead of both resolving to the first match.
 */
export function findPlaceholderOccurrences(
	text: string,
	placeholderContent: Record<string, PlaceholderContent>,
): PlaceholderOccurrence[] {
	// Longest display text first, so a placeholder whose text merely starts with
	// another's can't be claimed by the shorter one.
	const candidates = Object.entries(placeholderContent)
		.filter(([, content]) => Boolean(content.displayText))
		.sort(([, a], [, b]) => b.displayText.length - a.displayText.length);

	const claimed = new Set<string>();
	const occurrences: PlaceholderOccurrence[] = [];

	let index = 0;
	while (index < text.length) {
		const hit = candidates.find(
			([id, content]) =>
				!claimed.has(id) && text.startsWith(content.displayText, index),
		);

		if (!hit) {
			index++;
			continue;
		}

		const [id, content] = hit;
		claimed.add(id);
		occurrences.push({
			id,
			start: index,
			end: index + content.displayText.length,
		});
		index += content.displayText.length;
	}

	return occurrences;
}
