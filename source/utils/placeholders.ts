import type {PlaceholderContent} from '../types/hooks';
import {PlaceholderType} from '../types/hooks';

const ID_PREFIX: Record<PlaceholderType, string> = {
	[PlaceholderType.PASTE]: 'paste',
	[PlaceholderType.FILE]: 'file',
};

export interface AllocatedPlaceholderId {
	/** Map key. Namespaced by type so two kinds can never collide. */
	id: string;
	/** Human-facing counter used in the placeholder's display text. */
	ordinal: number;
}

/**
 * Allocate the map key for a new placeholder of `type`.
 *
 * The ordinal comes from the highest ordinal already present, not from the
 * number of live entries: deleting a placeholder must not free its id, or the
 * next allocation would silently overwrite a placeholder still in the input.
 */
export function allocatePlaceholderId(
	existing: Record<string, PlaceholderContent>,
	type: PlaceholderType,
): AllocatedPlaceholderId {
	const prefix = ID_PREFIX[type];
	const namespaced = new RegExp(`^${prefix}_(\\d+)$`);

	let highest = 0;
	for (const key of Object.keys(existing)) {
		const match = key.match(namespaced);
		if (match) {
			highest = Math.max(highest, Number(match[1]));
			continue;
		}
		// Prompt history persists InputState to disk, so bare-numeric paste keys
		// written before pastes were namespaced can still arrive from an older
		// session's history file.
		if (type === PlaceholderType.PASTE && /^\d+$/.test(key)) {
			highest = Math.max(highest, Number(key));
		}
	}

	const ordinal = highest + 1;
	return {id: `${prefix}_${ordinal}`, ordinal};
}

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
