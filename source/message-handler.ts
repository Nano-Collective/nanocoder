import type {CustomCommandLoader} from '@/custom-commands/loader';
import {
	appendPostToolUseOutput,
	runPreToolUseGate,
} from '@/services/lifecycle-hooks';
import type {ToolManager} from '@/tools/tool-manager';
import type {
	ToolCall,
	ToolExecutionContext,
	ToolHandler,
	ToolResult,
} from '@/types/index';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {toolErrorToContent} from '@/utils/tool-validation';
import {truncateToolResult} from '@/utils/truncate-tool-result';

// This will be set by the ChatSession
let toolRegistryGetter: (() => Record<string, ToolHandler>) | null = null;

// This will be set by the App
let toolManagerGetter: (() => ToolManager | null) | null = null;

// Set by the init paths so slash commands can reach the already-populated
// CustomCommandLoader (the one bundle skills also registered into) instead
// of spinning up a fresh instance that only knows about flat .nanocoder/commands/.
let commandLoaderGetter: (() => CustomCommandLoader | null) | null = null;

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

export function setCommandLoaderGetter(
	getter: () => CustomCommandLoader | null,
) {
	commandLoaderGetter = getter;
}

export function getCommandLoader(): CustomCommandLoader | null {
	return commandLoaderGetter ? commandLoaderGetter() : null;
}

export async function processToolUse(
	toolCall: ToolCall,
	options?: ToolExecutionContext,
): Promise<ToolResult> {
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

		// Lifecycle gate: a pre-tool-use hook that exits non-zero denies the
		// call outright, and its output goes back to the model as the reason so
		// it can adapt instead of retrying blindly.
		const gate = await runPreToolUseGate(toolCall, parsedArgs);
		if (gate.blocked) {
			return {
				tool_call_id: toolCall.id,
				role: 'tool',
				name: toolCall.function.name,
				content: truncateToolResult(`Error: ${gate.reason}`),
				isError: true,
			};
		}

		const result = await handler(parsedArgs, options);
		// Handlers may return a plain string or structured output. Only an
		// object carrying `llmContent` is treated as structured; anything else
		// (string, or a legacy undefined) passes through as the content.
		const isStructured =
			result && typeof result === 'object' && 'llmContent' in result;
		const rawContent = isStructured ? result.llmContent : result;
		const content =
			typeof rawContent === 'string'
				? truncateToolResult(rawContent)
				: (rawContent as string);

		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			name: toolCall.function.name,
			// Only string content is extended; a structured payload passes
			// through untouched.
			content:
				typeof content === 'string'
					? await appendPostToolUseOutput(
							toolCall.function.name,
							parsedArgs,
							content,
						)
					: content,
			...(isStructured ? {structuredContent: result.structured} : {}),
		};
	} catch (error) {
		// Convert exceptions (including validation failures thrown by the
		// validated handler, and argument-parsing failures above) into
		// content the model can see and correct. `isError: true` lets callers
		// building telemetry/logs (e.g. the `--json` headless report) tell
		// this apart from a normal result without re-parsing `content`.
		//
		// post-tool-use fires here too: the event is "after a tool returns",
		// and a failed call is exactly what an audit-log or notification hook
		// most wants to see. Argument parsing may itself be what threw, so the
		// hook gets a best-effort lenient parse rather than nothing.
		const failedArgs = parseToolArguments<Record<string, unknown>>(
			toolCall.function.arguments,
		);
		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			name: toolCall.function.name,
			content: await appendPostToolUseOutput(
				toolCall.function.name,
				failedArgs,
				truncateToolResult(toolErrorToContent(error)),
			),
			isError: true,
		};
	}
}
