import React from 'react';
import type {ToolExecutionOutcome} from '@/agent-loop/turn-engine';
import type {ConversationStateManager} from '@/app/utils/conversation-state';
import {
	observeSuccessfulLifecycleTool,
	type WalkthroughLifecycle,
} from '@/artifacts/walkthrough-lifecycle';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import {getAppConfig} from '@/config/index';
import {
	TOOL_APPROVAL_REQUIRED_KIND,
	TOOL_APPROVAL_REQUIRED_PREFIX,
} from '@/constants';
import {consultPluginPermission} from '@/plugins/host';
import {CheckpointManager} from '@/services/checkpoint-manager';
import {runPreToolUseGate} from '@/services/lifecycle-hooks';
import {getProjectRoot} from '@/services/session-cwd';
import {resolveToolApproval} from '@/tools/approval-policy';
import {isFileMutationTool} from '@/tools/runtime/tool-approval';
import {parseToolArguments} from '@/tools/runtime/tool-args-parser';
import {
	createApprovalUnavailableResults,
	createCancellationResults,
} from '@/tools/runtime/tool-cancellation';
import {signalToolConfirm} from '@/tools/runtime/tool-confirm-queue';
import {loadTasks} from '@/tools/tasks/storage';
import type {Task} from '@/tools/tasks/types';
import type {ToolManager} from '@/tools/tool-manager';
import type {
	DevelopmentMode,
	Message,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {generateKey} from '@/utils/key-generator';
import {notifyWarning} from '@/utils/message-queue-core';
import {closeAllDiffsInVSCode} from '@/vscode/index';
import {buildAutoDiagnosticsMessage} from './auto-diagnostics';
import {
	displayExecutedTool,
	executeApprovedTool,
	executeToolsDirectly,
} from './tool-executor';

/** How a tool turn ended the run early. */
export type ToolTurnStop = 'approval-unavailable' | 'declined' | 'nothing-ran';

export interface ArchitectCheckpointState {
	created: boolean;
	name?: string;
}

/**
 * Paths an architect turn is about to mutate, so they can be checkpointed
 * before the tools run.
 *
 * Membership comes from `isFileMutationTool`, the same registry that decides
 * architect waives approval. A hardcoded list here would drift from that one
 * and leave newly added mutators auto-executing outside the checkpoint.
 *
 * `path` and `destination` cover every file tool's argument shape today; a
 * mutator carrying neither contributes nothing rather than throwing, which
 * only costs the turn a revert for that one file.
 */
function getArchitectMutationPaths(toolCalls: ToolCall[]): string[] {
	const paths = new Set<string>();

	for (const toolCall of toolCalls) {
		if (!isFileMutationTool(toolCall.function.name)) {
			continue;
		}

		const args = toolCall.function.arguments as {
			path?: string;
			destination?: string;
		};

		// Both, not either: a move mutates its source and its destination.
		if (args.path) {
			paths.add(args.path);
		}

		if (args.destination) {
			paths.add(args.destination);
		}
	}

	return [...paths];
}

/**
 * What one tool turn needs from the interactive loop. Everything it reads or
 * writes is named here, rather than reached through the loop's closure.
 */
export interface ToolTurnContext {
	toolManager: ToolManager | null;
	signal: AbortSignal;
	addToChatQueue: (component: React.ReactNode) => void;
	setIsGenerating: (generating: boolean) => void;
	setLiveComponent?: (component: React.ReactNode) => void;
	conversationStateManager: React.MutableRefObject<ConversationStateManager>;
	compactToolDisplayRef?: React.RefObject<boolean>;
	compactToolCountsRef?: React.MutableRefObject<Record<string, number>>;
	onSetCompactToolCounts?: (counts: Record<string, number> | null) => void;
	onSetLiveTaskList?: (tasks: Task[] | null) => void;
	developmentMode: DevelopmentMode;
	developmentModeRef?: React.RefObject<DevelopmentMode>;
	nonInteractiveMode: boolean;
	architectCheckpointState?: ArchitectCheckpointState;
	currentProvider: string;
	currentModel: string;
	sessionId?: string;
	workingDirectory?: string;
	onToolExecuted?: (toolName: string) => void;
	walkthroughLifecycle: WalkthroughLifecycle;
	/** History as the turn started, for the architect checkpoint. */
	turnStartMessages: Message[];
	/** The tools this turn's request offered. */
	availableNames: string[];
	/** Why a call can't run under the mode as it is now, if it can't. */
	notOfferedReason: (toolCall: ToolCall) => string | undefined;
	/** Flush compact counts and the live task list to scrollback. */
	flushAll: () => Promise<void>;
	/** A task tool updated the live task list this turn. */
	markLiveTaskUpdates: () => void;
}

/**
 * One turn's valid tool calls: hook and plugin gates, approval routing, the
 * architect checkpoint, the auto-approved batch, then interactive
 * confirmation. Returns the results to record, or stops the run (approval
 * unavailable in a non-interactive run, or a declined confirmation).
 */
export async function runToolTurn(
	validToolCalls: ToolCall[],
	context: ToolTurnContext,
): Promise<ToolExecutionOutcome<ToolTurnStop>> {
	const {
		toolManager,
		signal,
		addToChatQueue,
		setIsGenerating,
		setLiveComponent,
		conversationStateManager,
		compactToolDisplayRef,
		compactToolCountsRef,
		onSetCompactToolCounts,
		onSetLiveTaskList,
		developmentMode,
		developmentModeRef,
		nonInteractiveMode,
		architectCheckpointState,
		currentProvider,
		currentModel,
		sessionId,
		workingDirectory,
		onToolExecuted,
		walkthroughLifecycle,
		turnStartMessages,
		availableNames,
		notOfferedReason,
		flushAll,
		markLiveTaskUpdates,
	} = context;

	// The SDK never auto-executes tools (execute is stripped). We evaluate
	// needsApproval ourselves, then run every tool through one routine that
	// gates each call: auto-approved tools execute immediately, the rest
	// suspend on a confirmation prompt before executing. No second code path.
	const autoTools: ToolCall[] = [];
	const confirmTools: ToolCall[] = [];
	// Results for tools a pre-tool-use hook refused. They skip execution
	// entirely but still need a result to pair with their tool call.
	const blockedResults: ToolResult[] = [];
	const refuseToolCall = (toolCall: ToolCall, reason: string) => {
		blockedResults.push({
			tool_call_id: toolCall.id,
			role: 'tool',
			name: toolCall.function.name,
			content: `Error: ${reason}`,
			isError: true,
		});
		addToChatQueue(
			<ErrorMessage
				key={generateKey('hook-blocked-tool')}
				message={reason}
				hideBox={true}
			/>,
		);
	};

	for (const toolCall of validToolCalls) {
		// Lifecycle gate, ahead of the approval decision. Every execution path
		// gates again at its own boundary, but only here is it in front of the
		// confirmation prompt — so a "never touch .env" hook refuses the call
		// instead of rendering a diff preview, collecting an approval, and
		// vetoing afterwards. runPreToolUseGate fires the hook once per tool
		// call, so the downstream gates cost nothing after this one.
		// Lenient: malformed arguments are the handler's error to report,
		// and the hook should still see what the model actually sent.
		const parsedArgs = parseToolArguments<Record<string, unknown>>(
			toolCall.function.arguments,
		);
		const gate = await runPreToolUseGate(toolCall, parsedArgs);
		if (gate.blocked) {
			refuseToolCall(
				toolCall,
				gate.reason ?? 'Blocked by a pre-tool-use hook.',
			);
			continue;
		}

		const toolEntry = toolManager?.getToolEntry(toolCall.function.name);
		const needsApproval = await resolveToolApproval(
			toolCall.function.name,
			toolEntry,
			toolCall.function.arguments,
			{
				// Prefer the live ref so a mode switch made while this turn's
				// tools are still executing takes effect on the next call.
				mode: developmentModeRef?.current ?? developmentMode,
				// The top-level alwaysAllow list applies in interactive
				// sessions too; plan mode stays safe because a call to a tool
				// its mode excludes is refused before it gets here.
				alwaysAllow: getAppConfig().alwaysAllow ?? [],
			},
		);

		if (needsApproval) {
			const vote = await consultPluginPermission(
				toolCall.function.name,
				parsedArgs,
			);
			if (vote.decision === 'deny') {
				refuseToolCall(toolCall, vote.reason);
				continue;
			}
			confirmTools.push(toolCall);
		} else {
			autoTools.push(toolCall);
		}
	}

	// Display/tally options shared by auto and post-approval execution so a
	// tool renders identically however it was approved.
	const displayOptions = {
		compactDisplay: compactToolDisplayRef?.current,
		onCompactToolCount: (toolName: string) => {
			if (compactToolCountsRef) {
				const counts = compactToolCountsRef.current;
				counts[toolName] = (counts[toolName] ?? 0) + 1;
				onSetCompactToolCounts?.({...counts});
			}
		},
		onLiveTaskUpdate: (tasks?: Task[]) => {
			markLiveTaskUpdates();
			if (tasks) {
				onSetLiveTaskList?.(tasks);
			} else {
				loadTasks(sessionId).then(loaded => {
					onSetLiveTaskList?.(loaded);
				});
			}
		},
		nonInteractiveMode,
	};

	const turnResults: ToolResult[] = [...blockedResults];
	// Set when beforeExecute stops the auto batch, which then accounts for
	// the tools behind it itself (cancelled, or moved to confirmTools).
	let batchStoppedByGate = false;

	// Refuse `toolCall` and cancel the rest of the auto batch behind it.
	const stopBatchAt = (toolCall: ToolCall, reason: string) => {
		batchStoppedByGate = true;
		refuseToolCall(toolCall, reason);
		turnResults.push(
			blockedResults[blockedResults.length - 1],
			...createCancellationResults(
				autoTools.slice(autoTools.indexOf(toolCall) + 1),
			),
		);
		return false;
	};

	const inArchitectMode =
		developmentModeRef?.current === 'architect' ||
		developmentMode === 'architect';

	if (inArchitectMode && architectCheckpointState) {
		const mutationPaths = getArchitectMutationPaths(autoTools);

		if (mutationPaths.length > 0) {
			// A failure here must not take the turn down with it: the tools
			// below have not run yet, so the user would lose the whole turn
			// over a checkpoint they never asked for. Warn and carry on
			// unprotected rather than abort - the review gate reads
			// `created` and simply will not offer revert.
			try {
				const checkpointManager = new CheckpointManager(getProjectRoot());

				if (!architectCheckpointState.created) {
					const checkpointMetadata = await checkpointManager.saveCheckpoint(
						`architect-${new Date().toISOString().replace(/[:.]/g, '-')}`,
						turnStartMessages,
						currentProvider,
						currentModel,
						mutationPaths,
					);

					architectCheckpointState.created = true;
					architectCheckpointState.name = checkpointMetadata.name;
				} else if (architectCheckpointState.name) {
					await checkpointManager.extendCheckpoint(
						architectCheckpointState.name,
						mutationPaths,
					);
				}
			} catch (error) {
				notifyWarning('Could not checkpoint architect turn', true, {
					context: {
						error: formatError(error),
						paths: mutationPaths.join(', '),
					},
				});
			}
		}
	}

	// 1) Auto-approved tools execute as a batch (parallelizes consecutive
	//    read-only / agent runs).
	if (autoTools.length > 0) {
		const directResults = await executeToolsDirectly(
			autoTools,
			toolManager,
			conversationStateManager,
			addToChatQueue,
			{
				...displayOptions,
				setLiveComponent,
				signal: signal,
				executionContext: {sessionId, workingDirectory},
				beforeExecute: async toolCall => {
					// A mode switch since this batch was classified can hide the
					// tool; alwaysAllow must not run it under the new mode.
					const notOffered = notOfferedReason(toolCall);
					if (notOffered) {
						return stopBatchAt(toolCall, notOffered);
					}
					const needsApproval = await resolveToolApproval(
						toolCall.function.name,
						toolManager?.getToolEntry(toolCall.function.name),
						toolCall.function.arguments,
						{
							mode: developmentModeRef?.current ?? developmentMode,
							alwaysAllow: getAppConfig().alwaysAllow ?? [],
						},
					);
					if (!needsApproval) return true;
					const vote = await consultPluginPermission(
						toolCall.function.name,
						parseToolArguments<Record<string, unknown>>(
							toolCall.function.arguments,
						),
					);
					if (vote.decision === 'deny') {
						return stopBatchAt(toolCall, vote.reason);
					}
					batchStoppedByGate = true;
					confirmTools.unshift(...autoTools.slice(autoTools.indexOf(toolCall)));
					return false;
				},
			},
		);
		turnResults.push(...directResults);
		for (const [index, result] of directResults.entries()) {
			if (!result.isError) {
				onToolExecuted?.(result.name);
				const toolCall = autoTools[index];
				if (toolCall) {
					observeSuccessfulLifecycleTool(walkthroughLifecycle, toolCall);
				}
			}
		}
		// The batch stopped short on an abort: the tools it never started
		// still need a result each to pair with their tool call.
		if (!batchStoppedByGate && directResults.length < autoTools.length) {
			turnResults.push(
				...createCancellationResults(autoTools.slice(directResults.length)),
			);
		}
	}

	// 2) Non-interactive mode can't prompt, so exit when approval is needed.
	if (confirmTools.length > 0 && nonInteractiveMode) {
		await flushAll();
		const toolNames = confirmTools.map(tc => tc.function.name).join(', ');
		const errorMsg = `${TOOL_APPROVAL_REQUIRED_PREFIX}${toolNames}. Exiting non-interactive mode`;
		addToChatQueue(
			<ErrorMessage
				key={generateKey(TOOL_APPROVAL_REQUIRED_KIND)}
				message={errorMsg}
				hideBox={true}
			/>,
		);
		// The assistant message already announces confirmTools' tool_calls;
		// pair each with a result so the saved history keeps the
		// provider-required 1:1 call/result mapping.
		return {
			kind: 'stop',
			payload: 'approval-unavailable',
			results: [
				...turnResults,
				...createApprovalUnavailableResults(confirmTools),
			],
			messages: [{role: 'assistant', content: errorMsg, displayOnly: true}],
		};
	}

	// 3) Interactive confirmation: gate each remaining tool, execute on
	//    approval. A decline cancels the rest and returns control to the user.
	if (confirmTools.length > 0) {
		// Flush accumulated auto-exec output before the prompt, and stop the
		// thinking spinner so the confirmation UI renders cleanly.
		await flushAll();
		setIsGenerating(false);
		const {processToolUse} = await import('@/message-handler');
		const processToolWithContext = (toolCall: ToolCall) =>
			processToolUse(toolCall, {
				abortSignal: signal,
				sessionId,
				workingDirectory,
			});

		for (let i = 0; i < confirmTools.length; i++) {
			const toolCall = confirmTools[i];
			// Don't ask about a tool a mode switch has since hidden.
			const notOffered = notOfferedReason(toolCall);
			if (notOffered) {
				refuseToolCall(toolCall, notOffered);
				turnResults.push(blockedResults[blockedResults.length - 1]);
				continue;
			}
			// Escape answers the prompt directly, but a turn aborted any
			// other way must also release it - otherwise the loop stays
			// parked here and the confirmation for a dead turn stays on
			// screen. An abort settles this as "declined".
			const approved = await signalToolConfirm({toolCall}, signal);

			// Approved, but the turn was cancelled while the prompt was up:
			// treat it like a decline rather than running the tool.
			if (!approved || signal.aborted) {
				// Close any VS Code diff previews the formatter opened for the
				// declined tools (the approve path self-closes post-execution).
				closeAllDiffsInVSCode();
				// Record cancellation results for this tool and every remaining
				// one (keeps tool_call/result pairing intact), then stop without
				// re-prompting the model.
				turnResults.push(...createCancellationResults(confirmTools.slice(i)));
				addToChatQueue(
					<InfoMessage
						key={generateKey('tool-cancelled')}
						message="Tool execution cancelled by user."
						hideBox={true}
					/>,
				);
				return {kind: 'stop', payload: 'declined', results: turnResults};
			}

			// Approved: execute + display through the same primitives the auto
			// batch uses. isGenerating is true so the live area renders and the
			// global Escape handler stays armed during execution.
			setIsGenerating(true);
			const execution = await executeApprovedTool(
				toolCall,
				toolManager,
				processToolWithContext,
				setLiveComponent,
				signal,
			);
			turnResults.push(execution.result);
			if (!execution.result.isError) {
				onToolExecuted?.(execution.result.name);
				observeSuccessfulLifecycleTool(walkthroughLifecycle, toolCall);
			}
			await displayExecutedTool(
				execution,
				toolManager,
				addToChatQueue,
				conversationStateManager,
				displayOptions,
			);

			// Escape during execution: stop prompting further tools; the abort
			// unwinds on the continuation's next LLM call (same as the auto
			// path), surfacing as "Interrupted by user.". Cancel the tools we
			// never reached so the saved history keeps the provider-required
			// 1:1 tool_call/result pairing.
			if (signal.aborted) {
				turnResults.push(
					...createCancellationResults(confirmTools.slice(i + 1)),
				);
				break;
			}
		}
	}

	// 4) Feed all results back to the model and continue the loop.
	if (turnResults.length === 0) {
		return {kind: 'stop', payload: 'nothing-ran'};
	}
	let autoDiagnosticsMessage: Message | null = null;
	if (availableNames.includes('lsp_get_diagnostics')) {
		const {processToolUse} = await import('@/message-handler');
		autoDiagnosticsMessage = await buildAutoDiagnosticsMessage(
			validToolCalls,
			turnResults,
			processToolUse,
		);
	}
	return {
		kind: 'continue',
		results: turnResults,
		messages: autoDiagnosticsMessage ? [autoDiagnosticsMessage] : [],
	};
}
