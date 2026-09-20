import {
	InputState,
	PlaceholderContent,
	PlaceholderType,
} from '../types/hooks.js';
import {loadFileContent} from './file-content-loader.js';

/**
 * Handle @file mention by creating a placeholder
 * Called when file is selected from autocomplete or on message submit
 *
 * Returns null if file doesn't exist (silent failure per spec)
 */
export async function handleFileMention(
	filePath: string,
	currentDisplayValue: string,
	currentPlaceholderContent: Record<string, PlaceholderContent>,
	mentionText: string, // The original "@src/app.tsx:10-20" text to replace
	lineRange?: {start: number; end?: number},
): Promise<InputState | null> {
	// Load file content
	const fileResult = await loadFileContent(filePath, lineRange);

	// If file doesn't exist or failed to load, return null (silently skip per spec)
	if (!fileResult.success) {
		return null;
	}

	// Generate unique ID for this file placeholder
	const existingFileCount = Object.values(currentPlaceholderContent).filter(
		content => content.type === PlaceholderType.FILE,
	).length;
	const fileId = `file_${existingFileCount + 1}`;

	// Create compact placeholder for display
	const placeholder = lineRange
		? `[@${filePath}:${lineRange.start}${
				lineRange.end ? `-${lineRange.end}` : ''
			}]`
		: `[@${filePath}]`;

	// Create file placeholder content
	// Use the existing FilePlaceholderContent interface
	const fileContent: PlaceholderContent = {
		type: PlaceholderType.FILE,
		displayText: placeholder,
		filePath: fileResult.metadata.absolutePath,
		content: fileResult.content || '',
		lastModified: Date.now(),
		encoding: 'utf-8',
		fileSize: fileResult.metadata.size,
	};

	const newPlaceholderContent = {
		...currentPlaceholderContent,
		[fileId]: fileContent,
	};

	// Replace the @mention text with placeholder in display
	const newDisplayValue = currentDisplayValue.replace(mentionText, placeholder);

	return {
		displayValue: newDisplayValue,
		placeholderContent: newPlaceholderContent,
	};
}

/**
 * Parse line range from mention text if present
 * e.g., "@app.tsx:10-20" -> {start: 10, end: 20}
 */
export function parseLineRangeFromMention(
	mentionText: string,
): {start: number; end?: number} | undefined {
	const match = mentionText.match(/:(\d+)(?:-(\d+))?$/);
	if (!match) {
		return undefined;
	}

	const start = parseInt(match[1], 10);
	const end = match[2] ? parseInt(match[2], 10) : undefined;

	return {start, end};
}
