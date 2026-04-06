import {Box, Text} from 'ink';
import React from 'react';
import {ErrorMessage} from '@/components/message-box';
import ToolMessage from '@/components/tool-message';
import {useTheme} from '@/hooks/useTheme';
import type {ToolManager} from '@/tools/tool-manager';
import type {ToolCall, ToolResult} from '@/types/index';
import {parseToolArguments} from '@/utils/tool-args-parser';

/**
 * Tools that should always show expanded (full formatter) output,
 * even when compact display mode is enabled.
 */
export const ALWAYS_EXPANDED_TOOLS = new Set([
	'create_task',
	'list_tasks',
	'update_task',
	'delete_task',
]);

/**
 * Task tools that should render in the live area (updating in-place)
 * instead of appending to the static chat queue each time.
 */
export const LIVE_TASK_TOOLS = new Set([
	'create_task',
	'list_tasks',
	'update_task',
	'delete_task',
]);

/**
 * Compact tool result display - shows "⚒ toolName  description" in tool color.
 */
function CompactToolResult({
	toolName,
	description,
}: {
	toolName: string;
	description: string;
}) {
	const {colors} = useTheme();
	return (
		<Text color={colors.tool}>
			{'\u2692'} {description}
		</Text>
	);
}

/**
 * Generate a compact grouped description for N calls of the same tool.
 * Always uses count-based phrasing for consistency.
 */
function getGroupedCompactDescription(toolName: string, count: number): string {
	const s = count === 1 ? '' : 's';
	switch (toolName) {
		case 'read_file':
			return `Read ${count} file${s}`;
		case 'write_file':
			return `Wrote ${count} file${s}`;
		case 'string_replace':
			return `Made ${count} edit${s}`;
		case 'execute_bash':
			return `Ran ${count} command${s}`;
		case 'search_file_contents':
			return `Searched for ${count} pattern${s}`;
		case 'find_files':
			return `Ran ${count} file search${count === 1 ? '' : 'es'}`;
		case 'list_directory':
			return `Listed ${count} director${count === 1 ? 'y' : 'ies'}`;
		case 'web_search':
			return `Ran ${count} web search${count === 1 ? '' : 'es'}`;
		case 'fetch_url':
			return `Fetched ${count} URL${s}`;
		case 'git_status':
		case 'git_diff':
		case 'git_log':
			return `Ran ${count} git command${s}`;
		case 'lsp_get_diagnostics':
			return `Got diagnostics ${count} time${s}`;
		case 'ask_question':
			return `Asked ${count} question${s}`;
		case 'agent':
			return `Delegated ${count} task${s} to subagent${s}`;
		default:
			return `Executed ${toolName} \u00d7 ${count}`;
	}
}

/**
 * Live display component for running compact tool counts.
 * Shows accumulated counts during execution (e.g. "⚒ Read 7 files").
 * Rendered in the live area (not Static) so it updates in-place.
 */
export function LiveCompactCounts({counts}: {counts: Record<string, number>}) {
	const {colors} = useTheme();
	return (
		<Box flexDirection="column" marginBottom={1}>
			{Object.entries(counts).map(([toolName, count]) => (
				<Text key={toolName} color={colors.tool}>
					{'\u2692'} {getGroupedCompactDescription(toolName, count)}
				</Text>
			))}
		</Box>
	);
}

/**
 * Flush accumulated compact counts to the static chat queue.
 * Called when the conversation loop finishes to persist the summary.
 */
export function displayCompactCountsSummary(
	counts: Record<string, number>,
	addToChatQueue: (component: React.ReactNode) => void,
	getNextComponentKey: () => number,
): void {
	const entries = Object.entries(counts);
	if (entries.length === 0) return;

	// Wrap all entries in a single Box with marginBottom for consistent spacing
	addToChatQueue(
		<Box
			key={`tool-compact-summary-${getNextComponentKey()}`}
			flexDirection="column"
			marginBottom={1}
		>
			{entries.map(([toolName, count]) => (
				<CompactToolResult
					key={toolName}
					toolName={toolName}
					description={getGroupedCompactDescription(toolName, count)}
				/>
			))}
		</Box>,
	);
}

/**
 * Display tool result with proper formatting
 * Extracted to eliminate duplication between useChatHandler and useToolHandler
 *
 * @param toolCall - The tool call that was executed
 * @param result - The result from tool execution
 * @param toolManager - The tool manager instance (for formatters)
 * @param addToChatQueue - Function to add components to chat queue
 * @param getNextComponentKey - Function to generate unique React keys
 * @param compact - When true, show one-liner instead of full formatter output
 */
export async function displayToolResult(
	toolCall: ToolCall,
	result: ToolResult,
	toolManager: ToolManager | null,
	addToChatQueue: (component: React.ReactNode) => void,
	getNextComponentKey: () => number,
	compact?: boolean,
): Promise<void> {
	// Check if this is an error result
	const isError = result.content.startsWith('Error: ');

	if (isError) {
		// Display as error message - always shown in full
		const errorMessage = result.content.replace(/^Error: /, '');
		addToChatQueue(
			<ErrorMessage
				key={`tool-error-${
					result.tool_call_id
				}-${getNextComponentKey()}-${Date.now()}`}
				message={errorMessage}
				hideBox={true}
			/>,
		);
		return;
	}

	// Compact mode: show count-based one-liner instead of full formatter output
	// (skip for tools that should always show expanded output)
	if (compact && !ALWAYS_EXPANDED_TOOLS.has(result.name)) {
		const description = getGroupedCompactDescription(result.name, 1);
		addToChatQueue(
			<CompactToolResult
				key={`tool-compact-${result.tool_call_id}-${getNextComponentKey()}`}
				toolName={result.name}
				description={description}
			/>,
		);
		return;
	}

	if (toolManager) {
		const formatter = toolManager.getToolFormatter(result.name);
		if (formatter) {
			try {
				const parsedArgs = parseToolArguments(toolCall.function.arguments);
				const formattedResult = await formatter(parsedArgs, result.content);

				if (React.isValidElement(formattedResult)) {
					addToChatQueue(
						React.cloneElement(formattedResult, {
							key: `tool-result-${
								result.tool_call_id
							}-${getNextComponentKey()}-${Date.now()}`,
						}),
					);
				} else {
					addToChatQueue(
						<ToolMessage
							key={`tool-result-${
								result.tool_call_id
							}-${getNextComponentKey()}-${Date.now()}`}
							title={`⚒ ${result.name}`}
							message={String(formattedResult)}
							hideBox={true}
						/>,
					);
				}
			} catch {
				// If formatter fails, show raw result
				addToChatQueue(
					<ToolMessage
						key={`tool-result-${result.tool_call_id}-${getNextComponentKey()}`}
						title={`⚒ ${result.name}`}
						message={result.content}
						hideBox={true}
					/>,
				);
			}
		} else {
			// No formatter, show raw result
			addToChatQueue(
				<ToolMessage
					key={`tool-result-${result.tool_call_id}-${getNextComponentKey()}`}
					title={`⚒ ${result.name}`}
					message={result.content}
					hideBox={true}
				/>,
			);
		}
	}
}
