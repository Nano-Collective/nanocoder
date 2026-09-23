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
): InputState | null {
	if (pastedText.length === 0) {
		return null;
	}

	const threshold = getSingleLinePasteThreshold();

	// If single line and <= threshold chars, paste directly
	const lineCount = pastedText.split(LINE_BREAK).length;
	if (lineCount === 1 && pastedText.length <= threshold) {
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

	// For CLI paste detection, we need to replace the pasted text in the display value
	// Replace every exact occurrence, or append the placeholder if none is present.
	//
	// Appending needs a separator: two placeholders sitting flush against each
	// other look tidy in the composer but expand back to back at submit, fusing
	// the last line of one paste to the first line of the next (...AAABBB...).
	// A newline only when something precedes it and it does not already end in
	// whitespace, so an empty composer and a deliberate trailing space or
	// newline are all left exactly as the user left them.
	const separator =
		currentDisplayValue === '' || /\s$/.test(currentDisplayValue) ? '' : '\n';
	const newDisplayValue = currentDisplayValue.includes(pastedText)
		? currentDisplayValue.replaceAll(pastedText, placeholder)
		: currentDisplayValue + separator + placeholder;

	return {
		displayValue: newDisplayValue,
		placeholderContent: newPlaceholderContent,
	};
}
