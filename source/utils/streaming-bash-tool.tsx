import React from 'react';
import BashProgress from '@/components/bash-progress';
import type {BashExecutionState} from '@/services/bash-executor';
import {
	appendPostToolUseOutput,
	runPreToolUseGate,
} from '@/services/lifecycle-hooks';
import {generateKey} from '@/session/key-generator';
import {executeBashCommand, formatBashResultForLLM} from '@/tools/execute-bash';
import type {ToolManager} from '@/tools/tool-manager';
import type {ToolCall, ToolResult} from '@/types/core';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {formatValidationError} from '@/utils/tool-validation';

export interface StreamingBashRun {
	toolCall: ToolCall;
	result: ToolResult;
	/**
	 * Present only on a successful run. Absent when validation failed (the
	 * caller should render the error result via the normal formatter rather
	 * than a completed BashProgress card).
	 */
	bashState?: BashExecutionState;
}

/**
 * Run an `execute_bash` tool call through the streaming executor: validate the
 * args (the streaming executor bypasses the validated registry handler, so the
 * per-tool validator must run here), mount a live `BashProgress` so output shows
 * while the command runs, await completion, then clear the live component.
 *
 * Used by the unified tool-execution routine in `tool-executor` for both
 * auto-executed and user-approved bash calls, so the live bash rendering
 * behaves identically regardless of how the tool was approved. Callers own how
 * the completed state is displayed (inline vs. deferred tally).
 */
export async function runStreamingBashTool(
	toolCall: ToolCall,
	toolManager: ToolManager | null,
	setLiveComponent: (component: React.ReactNode) => void,
	keyPrefix: string,
	signal?: AbortSignal,
): Promise<StreamingBashRun> {
	const parsedArgs = parseToolArguments(toolCall.function.arguments);

	const validator = toolManager?.getToolValidator(toolCall.function.name);
	const validation = validator
		? await validator(parsedArgs)
		: ({valid: true} as const);
	if (!validation.valid) {
		setLiveComponent(null);
		return {
			toolCall,
			result: {
				tool_call_id: toolCall.id,
				role: 'tool' as const,
				name: toolCall.function.name,
				// A failed call still returns a result, so post-tool-use sees it —
				// matching processToolUse, where a validation throw lands in the
				// catch and fires the hook there.
				content: await appendPostToolUseOutput(
					toolCall.function.name,
					parsedArgs,
					formatValidationError(validation.error, validation.details),
				),
				isError: true,
			},
		};
	}

	// This path bypasses processToolUse (and therefore its hook gate), so the
	// lifecycle gate has to run here too — otherwise a policy hook on
	// execute_bash would be silently skipped for the interactive TUI, which is
	// exactly where it matters most. The conversation loop already gates before
	// prompting for approval; runPreToolUseGate is idempotent per tool call, so
	// this is a backstop for callers that reach here directly, not a second run
	// of the hook.
	const gate = await runPreToolUseGate(toolCall, parsedArgs);
	if (gate.blocked) {
		setLiveComponent(null);
		return {
			toolCall,
			result: {
				tool_call_id: toolCall.id,
				role: 'tool' as const,
				name: toolCall.function.name,
				content: `Error: ${gate.reason}`,
				isError: true,
			},
		};
	}

	const commandStr = parsedArgs.command as string;
	const {executionId, promise} = executeBashCommand(commandStr, {signal});
	setLiveComponent(
		<BashProgress
			key={generateKey(`${keyPrefix}-${toolCall.id}`)}
			executionId={executionId}
			command={commandStr}
			isLive={true}
		/>,
	);

	const bashState = await promise;
	setLiveComponent(null);

	const content = await appendPostToolUseOutput(
		toolCall.function.name,
		parsedArgs,
		formatBashResultForLLM(bashState),
	);

	return {
		toolCall,
		result: {
			tool_call_id: toolCall.id,
			role: 'tool' as const,
			name: toolCall.function.name,
			content,
		},
		bashState,
	};
}
