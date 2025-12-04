/**
 * Task Executor
 *
 * Executes individual tasks with focused context.
 * Each task runs in relative isolation with only the context
 * it needs from previous tasks.
 */

import type {LLMClient, Message, ToolCall} from '@/types/core';
import type {ToolManager} from '@/tools/tool-manager';
import type {
	Task,
	TaskResult,
	TaskExecutionContext,
	TrackedToolCall,
} from './types';
import {TaskStore} from './task-store';

/**
 * Build a focused prompt for executing a single task
 */
function buildTaskPrompt(context: TaskExecutionContext): string {
	const {
		task,
		originalGoal,
		accumulatedDiscoveries,
		accumulatedDecisions,
		previousResults,
	} = context;

	let prompt = `## Current Task
**Title:** ${task.title}
**Description:** ${task.description}

## Acceptance Criteria
${
	task.acceptanceCriteria.map(c => `- [ ] ${c}`).join('\n') ||
	'- Complete the task successfully'
}

## Original Goal
${originalGoal}

`;

	// Add context from previous tasks if available
	if (accumulatedDiscoveries.length > 0) {
		prompt += `## Key Discoveries So Far
${accumulatedDiscoveries.map(d => `- ${d}`).join('\n')}

`;
	}

	if (accumulatedDecisions.length > 0) {
		prompt += `## Decisions Made
${accumulatedDecisions.map(d => `- ${d}`).join('\n')}

`;
	}

	if (previousResults.length > 0) {
		prompt += `## Previous Task Results
${previousResults.map(r => `- ${r.summary}`).join('\n')}

`;
	}

	// Add relevant file context if provided
	if (context.relevantFiles.length > 0) {
		prompt += `## Relevant Files
`;
		for (const file of context.relevantFiles) {
			prompt += `### ${file.path}${file.truncated ? ' (truncated)' : ''}
\`\`\`
${file.content}
\`\`\`

`;
		}
	}

	prompt += `## Instructions
Complete the current task. Focus ONLY on this specific task.
Do not proceed to other tasks - just complete this one.
Keep your response brief and focused on the task at hand.`;

	return prompt;
}

/**
 * Build execution context for a task
 */
function buildTaskExecutionContext(
	task: Task,
	taskStore: TaskStore,
): TaskExecutionContext {
	const accumulated = taskStore.getAccumulatedContext();
	const previousResults = taskStore.getDependencyResults(task.id);

	return {
		task,
		originalGoal: accumulated.originalGoal,
		previousResults,
		accumulatedDiscoveries: accumulated.discoveries,
		accumulatedDecisions: accumulated.decisions,
		relevantFiles: [], // Could be populated by pre-loading files from contextNeeded
	};
}

/**
 * Extract discoveries and decisions from the assistant's response
 */
function extractContextFromResponse(response: string): {
	discoveries: string[];
	decisions: string[];
	summary: string;
	passToNext: string[];
} {
	const discoveries: string[] = [];
	const decisions: string[] = [];
	const passToNext: string[] = [];
	let summary = '';

	// Look for structured sections in the response
	const lines = response.split('\n');
	let currentSection = '';

	for (const line of lines) {
		const trimmed = line.trim();

		// Detect section headers
		if (/^#+\s*(discover|finding|learned)/i.test(trimmed)) {
			currentSection = 'discoveries';
			continue;
		}
		if (/^#+\s*(decision|chose|decided)/i.test(trimmed)) {
			currentSection = 'decisions';
			continue;
		}
		if (/^#+\s*(pass|next|subsequent|future)/i.test(trimmed)) {
			currentSection = 'passToNext';
			continue;
		}
		if (/^#+\s*(summary|accomplished|completed)/i.test(trimmed)) {
			currentSection = 'summary';
			continue;
		}
		if (/^#+/.test(trimmed)) {
			currentSection = '';
			continue;
		}

		// Extract bullet points in current section
		const bulletMatch = trimmed.match(/^[-*•]\s*(.+)/);
		if (bulletMatch) {
			const content = bulletMatch[1].trim();
			if (content.length > 0) {
				switch (currentSection) {
					case 'discoveries':
						discoveries.push(content);
						break;
					case 'decisions':
						decisions.push(content);
						break;
					case 'passToNext':
						passToNext.push(content);
						break;
				}
			}
		}

		// Collect summary text
		if (currentSection === 'summary' && trimmed.length > 0) {
			summary += (summary ? ' ' : '') + trimmed;
		}
	}

	// If no structured summary found, use first substantial paragraph
	if (!summary) {
		const firstParagraph = response.split('\n\n')[0];
		summary = firstParagraph?.slice(0, 200) || 'Task completed';
	}

	return {discoveries, decisions, summary, passToNext};
}

/**
 * Track files read/modified from tool calls
 */
function trackFilesFromToolCalls(
	toolCalls: TrackedToolCall[],
	taskStore: TaskStore,
	taskId: string,
): void {
	for (const tracked of toolCalls) {
		const toolName = tracked.toolCall.function.name;
		const args = tracked.toolCall.function.arguments;

		// Extract file path from arguments
		let filePath: string | undefined;
		if (typeof args === 'object' && args !== null) {
			const pathValue = args.path;
			const filenameValue = args.filename;
			if (typeof pathValue === 'string') {
				filePath = pathValue;
			} else if (typeof filenameValue === 'string') {
				filePath = filenameValue;
			}
		}

		if (!filePath) continue;

		// Categorize by tool type
		switch (toolName) {
			case 'read_file':
			case 'search_files':
				taskStore.addFileRead(taskId, filePath);
				break;
			case 'create_file':
			case 'insert_lines':
			case 'replace_lines':
			case 'delete_lines':
				taskStore.addFileModified(taskId, filePath);
				break;
		}
	}
}

/**
 * Execute a single task
 *
 * This function runs the task to completion, handling tool calls
 * and tracking context accumulated during execution.
 */
export async function executeTask(
	client: LLMClient,
	toolManager: ToolManager,
	taskStore: TaskStore,
	task: Task,
	processToolUse: (toolCall: ToolCall) => Promise<{
		tool_call_id: string;
		role: 'tool';
		name: string;
		content: string;
	}>,
	signal?: AbortSignal,
	onToolResult?: (
		toolCall: ToolCall,
		result: {tool_call_id: string; role: 'tool'; name: string; content: string},
	) => Promise<void>,
): Promise<TaskResult> {
	// Mark task as started
	taskStore.startTask(task.id);

	// Build execution context
	const context = buildTaskExecutionContext(task, taskStore);

	// Build the focused prompt
	const taskPrompt = buildTaskPrompt(context);

	// Track tool calls made during execution
	const trackedToolCalls: TrackedToolCall[] = [];

	// Conversation for this task
	const messages: Message[] = [{role: 'user', content: taskPrompt}];

	let finalResponse = '';
	let iterations = 0;
	const maxIterations = 10; // Prevent infinite loops

	try {
		while (iterations < maxIterations) {
			iterations++;

			// Call LLM
			const response = await client.chat(
				messages,
				toolManager.getAllTools(),
				signal,
			);

			if (!response?.choices?.[0]?.message) {
				throw new Error('Empty response from model');
			}

			const assistantMessage = response.choices[0].message;
			messages.push({
				role: 'assistant',
				content: assistantMessage.content || '',
				tool_calls: assistantMessage.tool_calls,
			});

			// If no tool calls, we're done
			if (
				!assistantMessage.tool_calls ||
				assistantMessage.tool_calls.length === 0
			) {
				finalResponse = assistantMessage.content || '';
				break;
			}

			// Process tool calls
			for (const toolCall of assistantMessage.tool_calls) {
				const startTime = Date.now();

				try {
					const result = await processToolUse(toolCall);

					trackedToolCalls.push({
						toolCall,
						result: result.content,
						success: !result.content.startsWith('Error'),
						timestamp: startTime,
					});

					messages.push({
						role: 'tool',
						content: result.content,
						tool_call_id: result.tool_call_id,
						name: result.name,
					});

					// Display tool result if callback provided
					if (onToolResult) {
						await onToolResult(toolCall, result);
					}
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : 'Unknown error';

					trackedToolCalls.push({
						toolCall,
						result: errorMessage,
						success: false,
						timestamp: startTime,
					});

					messages.push({
						role: 'tool',
						content: `Error: ${errorMessage}`,
						tool_call_id: toolCall.id,
						name: toolCall.function.name,
					});
				}
			}
		}

		// Track files from tool calls
		trackFilesFromToolCalls(trackedToolCalls, taskStore, task.id);

		// Extract context from the response
		const extracted = extractContextFromResponse(finalResponse);

		// Add discoveries and decisions to task store
		for (const discovery of extracted.discoveries) {
			taskStore.addDiscovery(task.id, discovery);
		}
		for (const decision of extracted.decisions) {
			taskStore.addDecision(task.id, decision);
		}

		// Build result
		const result: TaskResult = {
			success: true,
			summary: extracted.summary,
			output: finalResponse,
			passToNext: extracted.passToNext,
		};

		// Complete the task
		taskStore.completeTask(task.id, result);

		return result;
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';

		// Check for cancellation
		if (errorMessage === 'Operation was cancelled') {
			throw error;
		}

		const result: TaskResult = {
			success: false,
			summary: 'Task failed',
			passToNext: [],
			error: errorMessage,
		};

		taskStore.failTask(task.id, errorMessage);

		return result;
	}
}
