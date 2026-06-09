import type {AISDKCoreTool} from '@/types/index';
import {formatToolsForPrompt} from './tool-prompt-formatter';
import {formatToolsForJSONPrompt} from './tool-prompt-formatter-json';

/**
 * Conditionally appends tool definitions to a system prompt. When native tool
 * calling is active, the SDK injects definitions via the provider's native
 * protocol so this returns the prompt untouched. When native is off, tool
 * definitions are embedded in the prompt text in either XML or JSON format
 * depending on the active fallback.
 */
export function appendToolDefinitionsToPrompt(
	basePrompt: string,
	toolsDisabled: boolean,
	fallbackFormat: 'xml' | 'json',
	tools: Record<string, AISDKCoreTool>,
): string {
	if (!toolsDisabled) return basePrompt;
	const toolPrompt =
		fallbackFormat === 'json'
			? formatToolsForJSONPrompt(tools)
			: formatToolsForPrompt(tools);
	return toolPrompt ? basePrompt + toolPrompt : basePrompt;
}
