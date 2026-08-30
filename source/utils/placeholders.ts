import type {PlaceholderContent} from '../types/hooks';
import {PlaceholderType} from '../types/hooks';

const ORDINAL = /^\d+$/;

const ID_PREFIX: Record<PlaceholderType, string> = {
	[PlaceholderType.PASTE]: 'paste',
	[PlaceholderType.FILE]: 'file',
};

const PASTE_MARKER = `${ID_PREFIX[PlaceholderType.PASTE]}_`;

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
	const marker = `${ID_PREFIX[type]}_`;

	let highest = 0;
	for (const key of Object.keys(existing)) {
		if (key.startsWith(marker)) {
			const ordinal = key.slice(marker.length);
			if (ORDINAL.test(ordinal)) {
				highest = Math.max(highest, Number(ordinal));
			}
			continue;
		}
		// Prompt history persists InputState to disk, so bare-numeric paste keys
		// written before pastes were namespaced can still arrive from an older
		// session's history file.
		if (type === PlaceholderType.PASTE && ORDINAL.test(key)) {
			highest = Math.max(highest, Number(key));
		}
	}

	const ordinal = highest + 1;
	return {id: `${marker}${ordinal}`, ordinal};
}

export interface PlaceholderOccurrence {
	id: string;
	/** Index of the placeholder's first character in the display value. */
	start: number;
	/** Index just past the placeholder's last character. */
	end: number;
}

/**
 * The text an entry renders as in the input.
 *
 * Prompt history persists InputState to disk, so paste entries written before
 * placeholders carried a `displayText` can still arrive from an older session's
 * history file. Rebuild the label those entries rendered with, from the
 * ordinal in their key and the content they hold, so they still expand instead
 * of reaching the model as their own literal label.
 */
function resolveDisplayText(id: string, content: PlaceholderContent): string {
	if (content.displayText) {
		return content.displayText;
	}

	if (content.type !== PlaceholderType.PASTE) {
		return '';
	}

	const ordinal = id.startsWith(PASTE_MARKER)
		? id.slice(PASTE_MARKER.length)
		: id;

	return ORDINAL.test(ordinal)
		? `[Paste #${ordinal}: ${content.content.length} chars]`
		: '';
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
		.map(([id, content]) => [id, resolveDisplayText(id, content)] as const)
		.filter(([, displayText]) => Boolean(displayText))
		.sort(([, a], [, b]) => b.length - a.length);

	const claimed = new Set<string>();
	const occurrences: PlaceholderOccurrence[] = [];

	let index = 0;
	while (index < text.length) {
		const hit = candidates.find(
			([id, displayText]) =>
				!claimed.has(id) && text.startsWith(displayText, index),
		);

		if (!hit) {
			index++;
			continue;
		}

		const [id, displayText] = hit;
		claimed.add(id);
		occurrences.push({
			id,
			start: index,
			end: index + displayText.length,
		});
		index += displayText.length;
	}

	return occurrences;
}
