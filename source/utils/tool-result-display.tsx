import {Box, Text} from 'ink';
import React from 'react';
import BashProgress from '@/components/bash-progress';
import {ErrorMessage} from '@/components/message-box';
import ToolMessage, {ToolOutputContext} from '@/components/tool-message';
import {useTheme} from '@/hooks/useTheme';
import type {BashExecutionState} from '@/services/bash-executor';
import {generateKey} from '@/session/key-generator';
import type {ToolManager} from '@/tools/tool-manager';
import type {ToolCall, ToolResult} from '@/types/index';
import {parseToolArguments} from '@/utils/tool-args-parser';

/**
 * Tools that should always show expanded (full formatter) output,
 * even when compact display mode is enabled.
 */
export const ALWAYS_EXPANDED_TOOLS = new Set(['write_tasks', 'ask_user']);

/**
 * Task tools that should render in the live area (updating in-place)
 * instead of appending to the static chat queue each time.
 */
export const LIVE_TASK_TOOLS = new Set(['write_tasks']);

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
 * Compact tool error display - shows "\u2692 toolName failed" in error red.
 * Used in compact display mode so failures don't dump the full verbose
 * error; the model still receives the full error in conversation history,
 * so this only trims what the user sees.
 */
function CompactToolError({toolName}: {toolName: string}) {
	const {colors} = useTheme();
	return (
		<Text color={colors.error}>
			{'\u2692'} {toolName} failed
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
		case 'ask_user':
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
	options?: {indent?: boolean},
): void {
	const entries = Object.entries(counts);
	if (entries.length === 0) return;

	// Indent the summary so it visually groups beneath its Thought header.
	// When no Thought precedes it (non-thinking models), render flat so the
	// summary doesn't look orphaned. marginBottom keeps spacing between turn
	// groups.
	const indent = options?.indent ?? true;
	addToChatQueue(
		<Box
			key={generateKey('tool-compact-summary')}
			flexDirection="column"
			marginLeft={indent ? 2 : 0}
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

interface ExpandableToolResult {
	id: number;
	toolCall: ToolCall;
	result: ToolResult;
	bashState?: BashExecutionState;
}

// Results older than this can no longer be expanded; bounds memory in long
// sessions while covering everything a user can still scroll back to.
const MAX_EXPANDABLE_RESULTS = 50;
const expandableResults: ExpandableToolResult[] = [];
let nextExpandId = 1;

/**
 * Remember a tool result so `/expand <id>` can print it in full later, even
 * when it was folded into a compact tally. Returns undefined for tools whose
 * output is never collapsed.
 */
export function recordExpandableToolResult(
	toolCall: ToolCall,
	result: ToolResult,
	bashState?: BashExecutionState,
): number | undefined {
	if (
		ALWAYS_EXPANDED_TOOLS.has(result.name) ||
		LIVE_TASK_TOOLS.has(result.name)
	) {
		return undefined;
	}

	const id = nextExpandId++;
	expandableResults.push({id, toolCall, result, bashState});
	if (expandableResults.length > MAX_EXPANDABLE_RESULTS) {
		expandableResults.shift();
	}
	return id;
}

export function getExpandableToolResults(): readonly ExpandableToolResult[] {
	return expandableResults;
}

export function clearExpandableToolResults(): void {
	expandableResults.length = 0;
}

/**
 * Generic failures are prefixed "Error: "; validation failures (bad arg
 * types, failed per-tool validators) come back as "⚒ Validation failed: …".
 * Both render as a red error so the user sees the same feedback the model
 * gets. Returns undefined for a successful result.
 */
function getToolErrorMessage(result: ToolResult): string | undefined {
	if (result.content.startsWith('⚒ Validation failed')) return result.content;
	if (result.content.startsWith('Error: ')) {
		return result.content.slice('Error: '.length);
	}
	return undefined;
}

/** The tool's formatter output, or its raw content when there is none. */
async function renderToolOutput(
	toolCall: ToolCall,
	result: ToolResult,
	toolManager: ToolManager,
): Promise<React.ReactElement> {
	const rawOutput = (
		<ToolMessage
			title={`⚒ ${result.name}`}
			message={result.content}
			hideBox={true}
		/>
	);
	const formatter = toolManager.getToolFormatter(result.name);
	if (!formatter) return rawOutput;

	try {
		const parsedArgs = parseToolArguments(toolCall.function.arguments);
		const formattedResult = await formatter(parsedArgs, result.content);
		return React.isValidElement(formattedResult) ? (
			formattedResult
		) : (
			<ToolMessage
				title={`⚒ ${result.name}`}
				message={String(formattedResult)}
				hideBox={true}
			/>
		);
	} catch {
		// If formatter fails, show raw result
		return rawOutput;
	}
}

/**
 * Display tool result with proper formatting
 * Extracted to eliminate duplication between useChatHandler and useToolHandler
 *
 * @param toolCall - The tool call that was executed
 * @param result - The result from tool execution
 * @param toolManager - The tool manager instance (for formatters)
 * @param addToChatQueue - Function to add components to chat queue
 * @param compact - When true, show one-liner instead of full formatter output
 * @param expandId - `/expand` number, shown in the "+N more lines" note
 */
export async function displayToolResult(
	toolCall: ToolCall,
	result: ToolResult,
	toolManager: ToolManager | null,
	addToChatQueue: (component: React.ReactNode) => void,
	compact?: boolean,
	expandId?: number,
): Promise<void> {
	const errorMessage = getToolErrorMessage(result);

	if (errorMessage !== undefined) {
		// Compact mode: condense failures to a short red one-liner
		// ("⚒ write_file ") instead of the full error output.
		// The model still receives the full error in conversation history,
		// so this only trims the user-facing display.
		if (compact && !ALWAYS_EXPANDED_TOOLS.has(result.name)) {
			addToChatQueue(
				<CompactToolError
					key={generateKey(`tool-error-compact-${result.tool_call_id}`)}
					toolName={result.name}
				/>,
			);
			return;
		}

		// Display as error message - shown in full
		addToChatQueue(
			<ErrorMessage
				key={generateKey(`tool-error-${result.tool_call_id}`)}
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
				key={generateKey(`tool-compact-${result.tool_call_id}`)}
				toolName={result.name}
				description={description}
			/>,
		);
		return;
	}

	if (!toolManager) return;

	const key = generateKey(`tool-result-${result.tool_call_id}`);
	const output = await renderToolOutput(toolCall, result, toolManager);
	addToChatQueue(
		expandId === undefined ? (
			React.cloneElement(output, {key})
		) : (
			<ToolOutputContext.Provider key={key} value={{expanded: false, expandId}}>
				{output}
			</ToolOutputContext.Provider>
		),
	);
}

/** Full, uncapped view of a recorded tool result, printed by `/expand`. */
export async function renderExpandedToolResult(
	entry: ExpandableToolResult,
	toolManager: ToolManager | null,
): Promise<React.ReactElement> {
	const {toolCall, result, bashState} = entry;
	const errorMessage = getToolErrorMessage(result);

	let output: React.ReactElement;
	if (errorMessage !== undefined) {
		output = <ErrorMessage message={errorMessage} hideBox={true} />;
	} else if (result.name === 'execute_bash' && bashState) {
		// The transcript card for a model-run command omits its output.
		output = (
			<BashProgress
				executionId={bashState.executionId}
				command={bashState.command}
				completedState={bashState}
				showOutput={true}
			/>
		);
	} else if (toolManager) {
		output = await renderToolOutput(toolCall, result, toolManager);
	} else {
		output = (
			<ToolMessage
				title={`⚒ ${result.name}`}
				message={result.content}
				hideBox={true}
			/>
		);
	}

	return (
		<ToolOutputContext.Provider
			key={generateKey(`tool-expand-${entry.id}`)}
			value={{expanded: true}}
		>
			{output}
		</ToolOutputContext.Provider>
	);
}
