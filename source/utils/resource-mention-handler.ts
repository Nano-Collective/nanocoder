import type {MCPClient} from '../mcp/mcp-client.js';
import {
	InputState,
	PlaceholderContent,
	PlaceholderType,
} from '../types/hooks.js';
import {allocatePlaceholderId} from './placeholders.js';

/**
 * Handle @resource mention by creating a placeholder
 * Called when resource is selected from autocomplete or on message submit
 *
 * Returns null if resource doesn't exist (silent failure per spec)
 */
export async function handleResourceMention(
	mcpClient: MCPClient,
	resourceUri: string,
	currentDisplayValue: string,
	currentPlaceholderContent: Record<string, PlaceholderContent>,
	mentionText: string, // The original "@resource:uri" text to replace
): Promise<InputState | null> {
	try {
		// Find the resource in the MCP client
		const allResources = mcpClient.getAllResources();
		const resource = allResources.find(r => r.uri === resourceUri);

		if (!resource) {
			return null;
		}

		// Read resource content from MCP server
		const resourceContent = await mcpClient.readResource(resourceUri);

		const {id: resourceId} = allocatePlaceholderId(
			currentPlaceholderContent,
			PlaceholderType.RESOURCE,
		);

		// Create compact placeholder for display
		const placeholder = `[@${resource.name}]`;

		// Create resource placeholder content
		const content: PlaceholderContent = {
			type: PlaceholderType.RESOURCE,
			displayText: placeholder,
			uri: resourceUri,
			content: resourceContent.text || resourceContent.blob || '',
			mimeType: resourceContent.mimeType,
			serverName: resource.serverName,
			resourceName: resource.name,
		};

		const newPlaceholderContent = {
			...currentPlaceholderContent,
			[resourceId]: content,
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
	} catch (_error) {
		// If resource read fails, return null (silently skip per spec)
		return null;
	}
}
