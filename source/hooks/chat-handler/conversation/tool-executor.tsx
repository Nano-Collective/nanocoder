import React from 'react';
import type {ConversationStateManager} from '@/app/utils/conversation-state';
import AgentProgress, {MultiAgentProgress} from '@/components/agent-progress';
import {ErrorMessage} from '@/components/message-box';
import {
	clearAllSubagentProgress,
	getSubagentProgress,
	resetSubagentProgressById,
} from '@/services/subagent-events';
import {MAX_CONCURRENT_AGENTS} from '@/subagents/subagent-executor';
import type {AgentToolArgs} from '@/tools/agent-tool';
import {startAgentExecution} from '@/tools/agent-tool';
import type {ToolManager} from '@/tools/tool-manager';
import type {ToolCall, ToolResult} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {parseToolArguments} from '@/utils/tool-args-parser';
import {
	ALWAYS_EXPANDED_TOOLS,
	displayToolResult,
	LIVE_TASK_TOOLS,
} from '@/utils/tool-result-display';

/**
 * Validates and executes a single tool call.
 * Returns the tool call paired with its result for sequential post-processing.
 */
const executeOne = async (
	toolCall: ToolCall,
	toolManager: ToolManager | null,
	processToolUse: (toolCall: ToolCall) => Promise<ToolResult>,
): Promise<{
	toolCall: ToolCall;
	result: ToolResult;
	validationError?: string;
}> => {
	try {
		// Run validator if available
		const validator = toolManager?.getToolValidator(toolCall.function.name);
		if (validator) {
			const parsedArgs = parseToolArguments(toolCall.function.arguments);
			const validationResult = await validator(parsedArgs);
			if (!validationResult.valid) {
				return {
					toolCall,
					result: {
						tool_call_id: toolCall.id,
						role: 'tool' as const,
						name: toolCall.function.name,
						content: `Validation failed: ${formatError(validationResult.error)}`,
					},
					validationError: validationResult.error,
				};
			}
		}

		const result = await processToolUse(toolCall);
		return {toolCall, result};
	} catch (error) {
		return {
			toolCall,
			result: {
				tool_call_id: toolCall.id,
				role: 'tool' as const,
				name: toolCall.function.name,
				content: `Error: ${formatError(error)}`,
			},
		};
	}
};

/** Classification for grouping tool calls */
type ToolGroup = 'readOnly' | 'agent' | 'other';

/**
 * Classify a tool call for grouping purposes.
 * Read-only tools and agent tools can be parallelized within their groups.
 */
const classifyTool = (
	toolCall: ToolCall,
	toolManager: ToolManager | null,
): ToolGroup => {
	if (toolCall.function.name === 'agent') return 'agent';
	if (toolManager?.isReadOnly(toolCall.function.name)) return 'readOnly';
	return 'other';
};

/**
 * Groups consecutive parallelizable tools for parallel execution.
 * Consecutive read-only tools and consecutive agent tools form parallel groups.
 * Other tools form single-item groups to preserve ordering.
 *
 * Example: [read, read, agent, agent, write, read] →
 *          [[read, read], [agent, agent], [write], [read]]
 */
const groupForParallelExecution = (
	tools: ToolCall[],
	toolManager: ToolManager | null,
): {group: ToolCall[]; type: ToolGroup}[] => {
	const groups: {group: ToolCall[]; type: ToolGroup}[] = [];
	let currentGroup: ToolCall[] = [];
	let currentType: ToolGroup | null = null;

	for (const toolCall of tools) {
		const type = classifyTool(toolCall, toolManager);
		const isParallelizable = type === 'readOnly' || type === 'agent';

		if (isParallelizable && type === currentType) {
			// Continue the current parallelizable group
			currentGroup.push(toolCall);
		} else {
			// Start a new group
			if (currentGroup.length > 0 && currentType !== null) {
				groups.push({group: currentGroup, type: currentType});
			}
			currentGroup = [toolCall];
			currentType = type;
		}
	}

	if (currentGroup.length > 0 && currentType !== null) {
		groups.push({group: currentGroup, type: currentType});
	}

	return groups;
};

/**
 * Execute a batch of agent tool calls in parallel.
 * Returns tool results for all agents.
 */
const executeAgentBatch = async (
	agentToolCalls: ToolCall[],
	toolManager: ToolManager | null,
	addToChatQueue: (component: React.ReactNode) => void,
	getNextComponentKey: () => number,
	compactDisplay?: boolean,
	setLiveComponent?: (component: React.ReactNode) => void,
): Promise<
	Array<{
		toolCall: ToolCall;
		result: ToolResult;
	}>
> => {
	// Enforce concurrency limit — return error results for excess agents
	const excessResults: Array<{toolCall: ToolCall; result: ToolResult}> = [];
	let toExecute = agentToolCalls;
	if (agentToolCalls.length > MAX_CONCURRENT_AGENTS) {
		const excess = agentToolCalls.slice(MAX_CONCURRENT_AGENTS);
		toExecute = agentToolCalls.slice(0, MAX_CONCURRENT_AGENTS);
		for (const toolCall of excess) {
			excessResults.push({
				toolCall,
				result: {
					tool_call_id: toolCall.id,
					role: 'tool' as const,
					name: toolCall.function.name,
					content: `Error: Maximum concurrent agent limit (${MAX_CONCURRENT_AGENTS}) exceeded. Please retry this agent call separately.`,
				},
			});
		}
	}

	// Start all agents
	const agentExecutions = toExecute.map(toolCall => {
		const parsedArgs = parseToolArguments(toolCall.function.arguments);
		const agentName = parsedArgs.subagent_type as string;
		const agentDesc = parsedArgs.description as string;

		const {agentId, promise} = startAgentExecution(
			parsedArgs as unknown as AgentToolArgs,
		);
		resetSubagentProgressById(agentId);

		return {toolCall, agentId, agentName, agentDesc, promise};
	});

	// Show live progress
	if (setLiveComponent && agentExecutions.length > 0) {
		const agentInfos = agentExecutions.map(e => ({
			agentId: e.agentId,
			subagentName: e.agentName,
			description: e.agentDesc,
		}));

		if (agentExecutions.length === 1) {
			const e = agentExecutions[0];
			setLiveComponent(
				<AgentProgress
					key={`agent-live-direct-${e.toolCall.id}-${Date.now()}`}
					subagentName={e.agentName}
					description={e.agentDesc}
					agentId={e.agentId}
					isLive={true}
				/>,
			);
		} else {
			setLiveComponent(
				<MultiAgentProgress
					key={`multi-agent-live-direct-${Date.now()}`}
					agents={agentInfos}
					isLive={true}
				/>,
			);
		}
	}

	// Await all results
	const settledResults = await Promise.allSettled(
		agentExecutions.map(e => e.promise),
	);

	// Clear live progress
	setLiveComponent?.(null);

	// Build results
	const results: Array<{toolCall: ToolCall; result: ToolResult}> = [];

	for (let i = 0; i < agentExecutions.length; i++) {
		const e = agentExecutions[i];
		const settled = settledResults[i];

		const agentResult =
			settled.status === 'fulfilled'
				? settled.value
				: {
						content: '',
						success: false,
						error:
							settled.reason instanceof Error
								? settled.reason.message
								: String(settled.reason),
					};

		const progress = getSubagentProgress(e.agentId);

		const result: ToolResult = {
			tool_call_id: e.toolCall.id,
			role: 'tool' as const,
			name: e.toolCall.function.name,
			content: agentResult.success
				? agentResult.content
				: `Error: ${agentResult.error || 'Subagent execution failed'}`,
		};

		results.push({toolCall: e.toolCall, result});

		// Compact: one-liner via displayToolResult. Non-compact: AgentProgress.
		if (compactDisplay) {
			await displayToolResult(
				e.toolCall,
				result,
				toolManager,
				addToChatQueue,
				getNextComponentKey,
				true, // force compact — prevents raw output dump
			);
		} else {
			addToChatQueue(
				<AgentProgress
					key={`agent-complete-${e.toolCall.id}-${getNextComponentKey()}-${Date.now()}`}
					subagentName={e.agentName}
					description={e.agentDesc}
					agentId={e.agentId}
					completedState={{
						toolCallCount: progress.toolCallCount,
						tokenCount: progress.tokenCount,
						success: agentResult.success,
					}}
				/>,
			);
		}
	}

	clearAllSubagentProgress();

	// Append error results for excess agents that were rejected
	for (const excess of excessResults) {
		results.push(excess);
		addToChatQueue(
			<ErrorMessage
				key={`agent-excess-${excess.toolCall.id}-${getNextComponentKey()}`}
				message={excess.result.content}
				hideBox={true}
			/>,
		);
	}

	return results;
};

/**
 * Executes tools directly without confirmation.
 * Read-only tools and agent tools in consecutive groups are executed in parallel.
 * Other tools are executed sequentially to preserve ordering.
 * Results are displayed in the original input order.
 *
 * @returns Array of tool results from executed tools
 */
export const executeToolsDirectly = async (
	toolsToExecuteDirectly: ToolCall[],
	toolManager: ToolManager | null,
	conversationStateManager: React.MutableRefObject<ConversationStateManager>,
	addToChatQueue: (component: React.ReactNode) => void,
	getNextComponentKey: () => number,
	options?: {
		compactDisplay?: boolean;
		onCompactToolCount?: (toolName: string) => void;
		onLiveTaskUpdate?: () => void;
		setLiveComponent?: (component: React.ReactNode) => void;
	},
): Promise<ToolResult[]> => {
	// Import processToolUse here to avoid circular dependencies
	const {processToolUse} = await import('@/message-handler');

	// Group consecutive parallelizable tools
	const groups = groupForParallelExecution(toolsToExecuteDirectly, toolManager);

	const directResults: ToolResult[] = [];

	for (const {group, type} of groups) {
		let executions: Array<{
			toolCall: ToolCall;
			result: ToolResult;
			validationError?: string;
		}>;

		if (type === 'agent' && group.length > 0) {
			// Parallel execution for consecutive agent tools
			const agentResults = await executeAgentBatch(
				group,
				toolManager,
				addToChatQueue,
				getNextComponentKey,
				options?.compactDisplay,
				options?.setLiveComponent,
			);

			// Agent results are already displayed by executeAgentBatch
			for (const {toolCall, result} of agentResults) {
				directResults.push(result);
				conversationStateManager.current.updateAfterToolExecution(
					toolCall,
					result.content,
				);
			}
			continue;
		}

		if (type === 'readOnly' && group.length > 1) {
			// Parallel execution for consecutive read-only tools
			executions = await Promise.all(
				group.map(toolCall =>
					executeOne(toolCall, toolManager, processToolUse),
				),
			);
		} else {
			// Sequential execution for non-parallelizable tools (or single-item groups)
			executions = [];
			for (const toolCall of group) {
				executions.push(
					await executeOne(toolCall, toolManager, processToolUse),
				);
			}
		}

		// Display results in order
		for (const {toolCall, result, validationError} of executions) {
			directResults.push(result);

			// Update conversation state
			conversationStateManager.current.updateAfterToolExecution(
				toolCall,
				result.content,
			);

			if (validationError) {
				// Display validation error (always shown in full)
				addToChatQueue(
					<ErrorMessage
						key={`validation-error-${toolCall.id}-${Date.now()}`}
						message={validationError}
						hideBox={true}
					/>,
				);
			} else if (
				LIVE_TASK_TOOLS.has(result.name) &&
				!result.content.startsWith('Error: ')
			) {
				// Task tools render in the live area (updating in-place)
				options?.onLiveTaskUpdate?.();
			} else if (
				options?.compactDisplay &&
				!ALWAYS_EXPANDED_TOOLS.has(result.name)
			) {
				// In compact mode, signal the count callback for live display
				// (skip for tools that should always show expanded output)
				const isError = result.content.startsWith('Error: ');
				if (isError) {
					// Errors always shown in full
					await displayToolResult(
						toolCall,
						result,
						toolManager,
						addToChatQueue,
						getNextComponentKey,
					);
				} else {
					options.onCompactToolCount?.(result.name);
				}
			} else {
				// Full display mode
				await displayToolResult(
					toolCall,
					result,
					toolManager,
					addToChatQueue,
					getNextComponentKey,
				);
			}
		}
	}

	return directResults;
};
