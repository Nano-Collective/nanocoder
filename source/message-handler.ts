import type {ToolCall, ToolResult, ToolHandler} from '@/types/index';
import type {ToolManager} from '@/tools/tool-manager';
import {formatError} from '@/utils/error-formatter';
import {parseToolArguments} from '@/utils/tool-args-parser';

// This will be set by the ChatSession
let toolRegistryGetter: (() => Record<string, ToolHandler>) | null = null;

// This will be set by the App
let toolManagerGetter: (() => ToolManager | null) | null = null;

export function setToolRegistryGetter(
	getter: () => Record<string, ToolHandler>,
) {
	toolRegistryGetter = getter;
}

export function setToolManagerGetter(getter: () => ToolManager | null) {
	toolManagerGetter = getter;
}

export function getToolManager(): ToolManager | null {
	return toolManagerGetter ? toolManagerGetter() : null;
}

export async function processToolUse(toolCall: ToolCall): Promise<ToolResult> {
	// Handle XML validation errors by throwing (will be caught and returned as error ToolResult)
	if (toolCall.function.name === '__xml_validation_error__') {
		const args = toolCall.function.arguments as {error: string};
		throw new Error(args.error);
	}

	if (!toolRegistryGetter) {
		throw new Error('Tool registry not initialized');
	}

	const toolRegistry = toolRegistryGetter();
	const handler = toolRegistry[toolCall.function.name];
	if (!handler) {
		throw new Error(`Unknown tool: ${toolCall.function.name}`);
	}

	try {
		// Parse arguments - use strict mode to throw error on parse failure
		// Strict mode is required here to catch malformed arguments before tool execution
		const parsedArgs = parseToolArguments<Record<string, unknown>>(
			toolCall.function.arguments,
			{strict: true},
		);
		const result = await handler(parsedArgs);
		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			name: toolCall.function.name,
			content: result,
		};
	} catch (error) {
		// Convert exceptions to error messages that the model can see and correct
		const errorMessage = `Error: ${formatError(error)}`;
		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			name: toolCall.function.name,
			content: errorMessage,
		};
	}
}
