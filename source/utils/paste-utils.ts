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

/** Render the label shown in the input for a paste placeholder. */
function formatPasteDisplayText(ordinal: number, size: number): string {
	return `[Paste #${ordinal}: ${size} chars]`;
}

/**
 * Restate an existing paste label at a new size, keeping its ordinal.
 * Used when a chunked paste grows after its placeholder already exists.
 */
export function resizePasteDisplayText(
	displayText: string,
	size: number,
): string {
	return displayText.replace(/: \d+ chars\]$/, `: ${size} chars]`);
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
	detectionMethod?: 'rate' | 'size' | 'multiline',
): InputState | null {
	if (pastedText.length === 0) {
		return null;
	}

	const threshold = getSingleLinePasteThreshold();

	// If single line and <= threshold chars, paste directly
	const lineCount = pastedText.split(/\r\n|\r|\n/).length;
	if (lineCount === 1 && pastedText.length <= threshold) {
		return null;
	}

	const {id: pasteId, ordinal} = allocatePlaceholderId(
		currentPlaceholderContent,
		PlaceholderType.PASTE,
	);
	const placeholder = formatPasteDisplayText(ordinal, pastedText.length);

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
	// If the pasted text is at the end, replace it. Otherwise append the placeholder.
	const newDisplayValue = currentDisplayValue.includes(pastedText)
		? currentDisplayValue.replace(pastedText, placeholder)
		: currentDisplayValue + placeholder;

	return {
		displayValue: newDisplayValue,
		placeholderContent: newPlaceholderContent,
	};
}
