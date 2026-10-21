import {getAppConfig} from '../config';
import {
	InputState,
	PastePlaceholderContent,
	PlaceholderContent,
	PlaceholderType,
} from '../types/hooks';
import {allocatePlaceholderId} from './placeholders';

/**
 * Default threshold for single-line paste handling.
 * Pastes <= this character limit are inserted directly without placeholders.
 */
export const DEFAULT_SINGLE_LINE_PASTE_THRESHOLD = 800;

const LINE_BREAK = /\r\n|\r|\n/;

/**
 * Size shown in a paste label: a line count for multi-line text, where it
 * says more at a glance, and a character count otherwise.
 */
function formatPasteSize(pastedText: string): string {
	// A trailing line break doesn't start a line the user pasted.
	const lineCount = pastedText
		.replace(/(\r\n|\r|\n)$/, '')
		.split(LINE_BREAK).length;
	return lineCount > 1 ? `${lineCount} lines` : `${pastedText.length} chars`;
}

/** Render the label shown in the input for a paste placeholder. */
function formatPasteDisplayText(ordinal: number, pastedText: string): string {
	return `[Paste #${ordinal}: ${formatPasteSize(pastedText)}]`;
}

/**
 * Restate an existing paste label for its grown content, keeping its ordinal.
 * Used when a chunked paste grows after its placeholder already exists.
 */
export function resizePasteDisplayText(
	displayText: string,
	pastedText: string,
): string {
	return displayText.replace(
		/: \d+ (chars|lines)\]$/,
		`: ${formatPasteSize(pastedText)}]`,
	);
}

function getSingleLinePasteThreshold(): number {
	const config = getAppConfig();
	return (
		config?.paste?.singleLineThreshold ?? DEFAULT_SINGLE_LINE_PASTE_THRESHOLD
	);
}

export function handlePaste(
	pastedText: string,
	currentDisplayValue: string,
	currentPlaceholderContent: Record<string, PlaceholderContent>,
	detectionMethod?: 'rate' | 'size' | 'multiline' | 'bracketed',
	cursorOffset?: number,
): InputState | null {
	if (pastedText.length === 0) {
		return null;
	}

	const threshold = getSingleLinePasteThreshold();

	// If single line and <= threshold chars, paste directly
	const lineCount = pastedText.split(LINE_BREAK).length;
	if (lineCount === 1 && pastedText.length <= threshold) {
		// With a cursor offset, splice the text in place rather than appending.
		// The caller is responsible for moving the caret after the splice.
		if (cursorOffset !== undefined) {
			const offset = clampCursorOffset(cursorOffset, currentDisplayValue);
			return {
				displayValue:
					currentDisplayValue.slice(0, offset) +
					pastedText +
					currentDisplayValue.slice(offset),
				placeholderContent: currentPlaceholderContent,
			};
		}
		return null;
	}

	const {id: pasteId, ordinal} = allocatePlaceholderId(
		currentPlaceholderContent,
		PlaceholderType.PASTE,
	);
	const placeholder = formatPasteDisplayText(ordinal, pastedText);

	const pasteContent: PastePlaceholderContent = {
		type: PlaceholderType.PASTE,
		displayText: placeholder,
		content: pastedText,
		originalSize: pastedText.length,
		detectionMethod,
		timestamp: Date.now(),
	};

	const newPlaceholderContent = {
		...currentPlaceholderContent,
		[pasteId]: pasteContent,
	};

	// Cursor-aware: splice the placeholder in at the caret so the user's
	// mid-string paste lands where they were editing, not at the end of the
	// value. Falls back to the legacy replace-or-append when no cursor is
	// known (heuristic paste detection paths).
	let newDisplayValue: string;
	if (cursorOffset !== undefined) {
		const offset = clampCursorOffset(cursorOffset, currentDisplayValue);
		newDisplayValue = spliceSeparated(currentDisplayValue, offset, placeholder);
	} else {
		newDisplayValue = currentDisplayValue.includes(pastedText)
			? currentDisplayValue.replaceAll(pastedText, placeholder)
			: spliceSeparated(
					currentDisplayValue,
					currentDisplayValue.length,
					placeholder,
				);
	}

	return {
		displayValue: newDisplayValue,
		placeholderContent: newPlaceholderContent,
	};
}

/**
 * Insert a placeholder at `offset`, on its own line where it would otherwise
 * touch other text. Two placeholders sitting flush against each other look
 * tidy in the composer but expand back to back at submit, fusing the last
 * line of one paste to the first line of the next (...AAABBB...). A newline
 * goes in only on a side where a non-whitespace character is adjacent, so an
 * empty composer and a deliberate space or newline are left as the user left
 * them.
 */
function spliceSeparated(
	value: string,
	offset: number,
	placeholder: string,
): string {
	const before = value.slice(0, offset);
	const after = value.slice(offset);
	const leading = before === '' || /\s$/.test(before) ? '' : '\n';
	const trailing = after === '' || /^\s/.test(after) ? '' : '\n';
	return before + leading + placeholder + trailing + after;
}

function clampCursorOffset(offset: number, value: string): number {
	if (offset < 0) return 0;
	if (offset > value.length) return value.length;
	return offset;
}
