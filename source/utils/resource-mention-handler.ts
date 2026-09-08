import type {MCPClient} from '../mcp/mcp-client.js';
import {
	InputState,
	PlaceholderContent,
	PlaceholderType,
} from '../types/hooks.js';
import {logError} from './message-queue.js';
import {allocatePlaceholderId} from './placeholders.js';

/**
 * Handle @resource mention by creating a placeholder. Called when a resource
 * is selected from autocomplete.
 *
 * `serverName` is required (rather than looked up by URI alone) because two
 * connected servers can expose a resource at the same URI — the completion
 * that triggers this already knows which server it came from, so that
 * identity must not get lost here.
 *
 * Returns null if the resource can't be read. An empty result is silent,
 * matching `handleFileMention`'s behavior for a missing file, but a thrown
 * read error is surfaced via `logError` first — a remote failure (server
 * error, timeout, unknown URI) isn't something the user can independently
 * notice the way a missing local file is.
 */
export async function handleResourceMention(
	mcpClient: MCPClient,
	serverName: string,
	resourceUri: string,
	resourceName: string,
	currentDisplayValue: string,
	currentPlaceholderContent: Record<string, PlaceholderContent>,
	mentionText: string, // The original "@resource:uri" text to replace
): Promise<InputState | null> {
	try {
		const blocks = await mcpClient.readResource(serverName, resourceUri);
		if (blocks.length === 0) {
			return null;
		}

		// Concatenate text blocks. A binary block (base64 `blob`) isn't useful
		// to an LLM as text, so it gets a short placeholder note instead of
		// its raw base64 dumped into the prompt.
		const content = blocks
			.map(block =>
				block.text !== undefined
					? block.text
					: `[binary resource: ${block.mimeType ?? 'unknown type'}, not inlined]`,
			)
			.join('\n\n');
		const mimeType = blocks[0]?.mimeType;

		const {id: resourceId} = allocatePlaceholderId(
			currentPlaceholderContent,
			PlaceholderType.RESOURCE,
		);

		// Create compact placeholder for display
		const placeholder = `[@${resourceName}]`;

		// Create resource placeholder content
		const placeholderContent: PlaceholderContent = {
			type: PlaceholderType.RESOURCE,
			displayText: placeholder,
			uri: resourceUri,
			content,
			mimeType,
			serverName,
			resourceName,
		};

		const newPlaceholderContent = {
			...currentPlaceholderContent,
			[resourceId]: placeholderContent,
		};

		// Replace the @mention text with placeholder in display
		const newDisplayValue = currentDisplayValue.replace(
			mentionText,
			placeholder,
		);

		return {
			displayValue: newDisplayValue,
			placeholderContent: newPlaceholderContent,
		};
	} catch (error) {
		// Unlike a missing local file, a failed remote read (server error,
		// timeout, unknown URI) is not something the user can see for
		// themselves, so it must not disappear silently the way
		// handleFileMention's missing-file case does - surface it and still
		// decline to create a placeholder.
		logError(
			`Failed to read MCP resource "${resourceName}" from "${serverName}": ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return null;
	}
}
