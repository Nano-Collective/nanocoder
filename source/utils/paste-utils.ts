import {
	InputState,
	PastePlaceholderContent,
	PlaceholderContent,
	PlaceholderType,
} from '../types/hooks';

const SINGLE_LINE_PASTE_THESHOLD_CHAR = 800;

export function handlePaste(
	pastedText: string,
	currentDisplayValue: string,
	currentPlaceholderContent: Record<string, PlaceholderContent>,
	detectionMethod?: 'rate' | 'size' | 'multiline',
): InputState | null {
	// If single line and <= 800 (default) chars, paste directly
	const lineCount = pastedText.split(/\r\n|\r|\n/).length;
	if (lineCount == 1 && pastedText.length <= SINGLE_LINE_PASTE_THESHOLD_CHAR) {
		return null;
	}

	//If multiline or large text, create a placeholder...

	// Generate simple incrementing ID based on existing paste placeholders
	const existingPasteCount = Object.values(currentPlaceholderContent).filter(
		content => content.type === PlaceholderType.PASTE,
	).length;
	const pasteId = (existingPasteCount + 1).toString();
	const placeholder = `[Paste #${pasteId}: ${pastedText.length} chars]`;

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
