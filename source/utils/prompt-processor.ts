import type {InputState} from '../types/hooks';
import {PlaceholderType} from '../types/hooks';

/**
 * Cached subagent descriptions for injection into the system prompt.
 * Set via setAvailableSubagents() during app initialization.
 */
let cachedSubagentDescriptions = 'No subagents available.';

/**
 * Set the available subagents for system prompt injection.
 * Call this during app initialization after the subagent loader is ready.
 */
export function setAvailableSubagents(
	agents: Array<{name: string; description: string}>,
): void {
	if (agents.length === 0) {
		cachedSubagentDescriptions = 'No subagents available.';
		return;
	}

	cachedSubagentDescriptions = agents
		.map(a => `- **${a.name}**: ${a.description}`)
		.join('\n');
}

/**
 * Get the current subagent descriptions for prompt building.
 */
export function getSubagentDescriptions(): string {
	return cachedSubagentDescriptions;
}

/**
 * Assemble the final prompt by replacing all placeholders with their full content
 * This function is called before sending the prompt to the AI
 */
export function assemblePrompt(inputState: InputState): string {
	let assembledPrompt = inputState.displayValue;

	// Replace each placeholder with its full content
	Object.entries(inputState.placeholderContent).forEach(
		([placeholderId, placeholderContent]) => {
			// Each placeholder type can have its own replacement logic
			let replacementContent = placeholderContent.content || '';

			// Type-specific content assembly (extensible for future types)
			switch (placeholderContent.type) {
				case PlaceholderType.PASTE: {
					// For paste, use content directly
					replacementContent = placeholderContent.content;
					break;
				}
				case PlaceholderType.FILE: {
					// Format file content with header for LLM context
					const fileName =
						placeholderContent.filePath.split('/').pop() ||
						placeholderContent.filePath;
					const header = `=== File: ${fileName} ===`;
					const footer = '='.repeat(header.length);
					replacementContent = `${header}\n${placeholderContent.content}\n${footer}`;
					break;
				}
				default: {
					placeholderContent satisfies never;
					replacementContent = '';
					break;
				}
			}

			// Use the displayText to find and replace the placeholder
			const displayText = placeholderContent.displayText;
			if (displayText) {
				assembledPrompt = assembledPrompt.replace(
					displayText,
					replacementContent,
				);
			} else {
				// Fallback for legacy paste format
				const placeholderPattern = `\\[Paste #${placeholderId}: \\d+ chars\\]`;
				const regex = new RegExp(placeholderPattern, 'g');
				assembledPrompt = assembledPrompt.replace(regex, replacementContent);
			}
		},
	);

	return assembledPrompt;
}
