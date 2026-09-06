import type {
	AgentSideConnection,
	PromptResponse,
	ToolCallStatus,
} from '@agentclientprotocol/sdk';
import {requestToolPermission} from '@/acp/acp-permission';
import {requestUserChoice} from '@/acp/acp-question';
import type {AcpSession} from '@/acp/acp-session';
import {beginTimelineCapture, finishTimelineCapture} from '@/acp/acp-timeline';
import {type AcpToolCallMeta, buildToolCallMeta} from '@/acp/acp-tool-call';
import type {
	ArtifactDescriptor,
	UserArtifactKind,
} from '@/artifacts/artifact-manager';
import {artifactManager} from '@/artifacts/artifact-manager';
import {
	createWalkthroughLifecycle,
	observeSuccessfulLifecycleTool,
	takeWalkthroughFallback,
} from '@/artifacts/walkthrough-lifecycle';
import {DEFAULT_HEADLESS_MAX_TURNS, getAppConfig} from '@/config/index';
import {
	buildAbandonedTurnMessages,
	partitionUnknownToolCalls,
} from '@/hooks/chat-handler/utils/tool-filters';
import {processToolUse} from '@/message-handler';
import {
	getAllSubagentProgress,
	type SubagentEvent,
} from '@/services/subagent-events';
import {parseToolCalls} from '@/tool-calling/index';
import {resolveToolApproval} from '@/tools/approval-policy';
import type {ToolManager} from '@/tools/tool-manager';
import type {
	ApiUsage,
	DevelopmentMode,
	LLMClient,
	Message,
	ModeOverrides,
	StreamCallbacks,
	ToolCall,
	ToolResult,
} from '@/types/core';
import {buildResponseUsage} from '@/usage/response-usage';
import {maybeAutoCompact} from '@/utils/auto-compact';
import {capMessagesForModel} from '@/utils/message-capping';
import {
	type PendingToolApproval,
	setGlobalToolApprovalHandler,
} from '@/utils/tool-approval-queue';
import {createCancellationResults} from '@/utils/tool-cancellation';
import {toOptionString} from '@/utils/type-helpers';

// On the last allowed turn we strip tools and inject this so the model
// finalizes cleanly instead of stopping mid-task at the turn ceiling.
const FINAL_TURN_INSTRUCTION =
	'You have reached the maximum number of tool-execution turns for this run. ' +
	'Do not call any more tools. Produce your final answer now using only the ' +
	'information you already have.';

const ARTIFACT_TOOL_KINDS: Record<string, UserArtifactKind> = {
	write_plan: 'implementation_plan',
	write_tasks: 'task',
	write_walkthrough: 'walkthrough',
};

const ARTIFACT_TITLES: Record<UserArtifactKind, string> = {
	implementation_plan: 'Implementation plan ready',
	task: 'Tasks updated',
	walkthrough: 'Walkthrough ready',
};

export interface RunAcpConversationOptions {
	session: AcpSession;
	client: LLMClient;
	toolManager: ToolManager;
	conn: AgentSideConnection;
	nonInteractiveAlwaysAllow: string[];
}

/**
 * Sub-agent tool calls reach the approval slot in tool-approval-queue, which
 * only the Ink UI installs a handler for. Under ACP the slot fell back to
 * denying, so a dispatched sub-agent was refused without the client seeing a
 * request. Route those to the same session/request_permission channel the
 * top-level calls use.
 */
function createSubagentApprovalHandler(
	session: AcpSession,
	conn: AgentSideConnection,
): (approval: PendingToolApproval) => Promise<boolean> {
	return async ({toolCall, subagentName}) => {
		// The sub-agent's own model names its tool calls and shares an id space
		// with the top-level ones, so prefix to keep the two cards distinct.
		const announced: ToolCall = {
			...toolCall,
			id: `${SUBAGENT_TOOL_CALL_PREFIX}${toolCall.id}`,
		};

		try {
			const meta = await buildToolCallMeta(announced);
			const subagentMeta: AcpToolCallMeta = {
				...meta,
				title: `${meta.title} (${subagentName})`,
			};

			// Announced first: a permission request naming a tool call the
			// client has not seen is rejected as invalid params.
			await emitToolCall(session, conn, announced, 'pending', subagentMeta);

			const permission = await requestToolPermission(
				session,
				announced,
				conn,
				subagentMeta,
				session.abortController.signal,
			);

			if (permission === 'approved') {
				// The sub-agent layer does not report its results back here, so
				// settle the card on approval rather than leave it spinning
				// forever. This does claim success before the tool has run: a
				// call that then fails still shows completed. Reporting the
				// real outcome means threading results out of the executor.
				await emitToolCall(
					session,
					conn,
					announced,
					'completed',
					subagentMeta,
					'tool_call_update',
				);
				return true;
			}

			await emitToolCallUpdate(
				session,
				conn,
				announced,
				'failed',
				permission === 'cancelled' ? 'Cancelled by user' : 'Denied by user',
			);
			return false;
		} catch {
			// signalToolApproval is awaited outside the sub-agent executor's own
			// try, so a transport failure here would abort the whole sub-agent
			// run. Deny the one tool instead and keep the safe-fallback posture.
			return false;
		}
	};
}

export async function runAcpConversation(
	options: RunAcpConversationOptions,
): Promise<PromptResponse> {
	// The slot is a module singleton with last-writer-wins semantics, so the
	// handler is scoped to this turn: without the teardown a finished turn's
	// session, connection and aborted controller stay reachable, and the last
	// turn to run would keep answering approvals for every later one.
	//
	// This does not make overlapping turns safe. turnActive is per session
	// (acp-session.ts), so two sessions can be mid-turn at once, and for that
	// window the later installer answers the earlier session's approvals
	// against the wrong session id and abort controller. The restore is
	// LIFO-correct, so routing rights hand back once the later turn ends.
	// Closing the window itself needs the slot keyed by session id, or an
	// approval channel threaded through SubagentExecutor.
	const restoreApprovalHandler = setGlobalToolApprovalHandler(
		createSubagentApprovalHandler(options.session, options.conn),
	);
	try {
		return await runTurn(options);
	} finally {
		restoreApprovalHandler();
	}
}

const SUBAGENT_TOOL_CALL_PREFIX = 'subagent:';

async function runTurn(
	options: RunAcpConversationOptions,
): Promise<PromptResponse> {
	const {session, client, toolManager, conn, nonInteractiveAlwaysAllow} =
		options;
	const {developmentMode, abortController} = session;

	let messages = session.messages;
	const walkthroughLifecycle = createWalkthroughLifecycle(messages);
	let wrotePlan = false;

	// Provider-reported usage accumulated across this prompt's model calls,
	// returned on the PromptResponse (experimental ACP `usage` field) so
	// clients like the VS Code extension can show a per-response indicator.
	// Fields stay undefined until a finite value arrives: zero-filling
	// unreported input/output would route a total-only report into the
	// input/output cost branch of buildResponseUsage and price it at $0.
	const turnUsage: ApiUsage = {};

	const recordUsage = (usage: ApiUsage | undefined) => {
		if (!usage) return;
		if (Number.isFinite(usage.inputTokens)) {
			turnUsage.inputTokens =
				(turnUsage.inputTokens ?? 0) + (usage.inputTokens as number);
		}
		if (Number.isFinite(usage.outputTokens)) {
			turnUsage.outputTokens =
				(turnUsage.outputTokens ?? 0) + (usage.outputTokens as number);
		}
		if (Number.isFinite(usage.cacheReadTokens)) {
			turnUsage.cacheReadTokens =
				(turnUsage.cacheReadTokens ?? 0) + (usage.cacheReadTokens as number);
		}
		if (Number.isFinite(usage.cacheWriteTokens)) {
			turnUsage.cacheWriteTokens =
				(turnUsage.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens as number);
		}
		// Keep the running total consistent when a call reports only
		// input/output: add their sum so mixed-report turns don't understate.
		const total = Number.isFinite(usage.totalTokens)
			? (usage.totalTokens as number)
			: Number.isFinite(usage.inputTokens) ||
					Number.isFinite(usage.outputTokens)
				? ((usage.inputTokens as number) || 0) +
					((usage.outputTokens as number) || 0)
				: undefined;
		if (total !== undefined) {
			turnUsage.totalTokens = (turnUsage.totalTokens ?? 0) + total;
		}
	};

	// Attach accumulated usage (and best-effort estimated cost via _meta) to
	// a turn-ending response. A no-op when no model call reported usage.
	const withTurnUsage = async (
		response: PromptResponse,
	): Promise<PromptResponse> => {
		const usageReported =
			turnUsage.inputTokens !== undefined ||
			turnUsage.outputTokens !== undefined ||
			turnUsage.totalTokens !== undefined ||
			turnUsage.cacheReadTokens !== undefined ||
			turnUsage.cacheWriteTokens !== undefined;
		if (!usageReported) return response;
		// Cost is computed from the sparse accumulators so a total-only turn
		// takes the lump-sum averaging branch instead of pricing 0+0 tokens.
		const priced = await buildResponseUsage(
			turnUsage,
			client.getCurrentModel(),
		);
		const input = turnUsage.inputTokens ?? 0;
		const output = turnUsage.outputTokens ?? 0;
		return {
			...response,
			// The ACP Usage type requires all three fields, so unreported ones
			// are zero-filled here — on the wire only, after cost is computed.
			usage: {
				inputTokens: input,
				outputTokens: output,
				totalTokens: turnUsage.totalTokens ?? input + output,
			},
			...(priced?.cost != null
				? {_meta: {'nanocoder/usage': {cost: priced.cost}}}
				: {}),
		};
	};

	const maxTurns =
		getAppConfig().headless?.maxTurns ?? DEFAULT_HEADLESS_MAX_TURNS;

	for (let turn = 0; turn < maxTurns; turn++) {
		if (abortController.signal.aborted) {
			session.messages = messages;
			return withTurnUsage({stopReason: 'cancelled'});
		}

		// On the final turn, force a tool-free wrap-up so we end with an answer
		// rather than stopping mid-task at the ceiling.
		const finalTurn = turn === maxTurns - 1;

		const availableNames = toolManager.getAvailableToolNames(
			undefined,
			developmentMode,
		);
		const tools = finalTurn ? {} : toolManager.getFilteredTools(availableNames);

		const modeOverrides: ModeOverrides = {
			nonInteractiveMode: true,
			nonInteractiveAlwaysAllow,
		};

		let streamedReasoning = '';

		const callbacks: StreamCallbacks = {
			onReasoningToken: (token: string) => {
				// Leading whitespace renders to nothing but still opens a thought
				// section, leaving a bare "Thought for 0s" bubble, so drop it.
				// Only what's emitted is accumulated: replaySessionHistory re-sends
				// the stored reasoning verbatim, so anything skipped here has to
				// stay out of the message or a reloaded session renders differently
				// from the live one.
				const text = streamedReasoning ? token : token.trimStart();
				if (!text) {
					return;
				}
				streamedReasoning += text;
				conn.sessionUpdate({
					sessionId: session.sessionId,
					update: {
						sessionUpdate: 'agent_thought_chunk',
						content: {type: 'text', text},
					},
				});
			},
			onToken: (token: string) => {
				conn.sessionUpdate({
					sessionId: session.sessionId,
					update: {
						sessionUpdate: 'agent_message_chunk',
						content: {type: 'text', text: token},
					},
				});
			},
		};

		const systemMessage = session.systemMessage;
		if (!systemMessage) {
			return withTurnUsage({stopReason: 'end_turn'});
		}

		const sessionConfig = getAppConfig().sessions;
		const maxMessages = sessionConfig?.maxMessages ?? 1000;
		const cappedMessages = capMessagesForModel(messages, maxMessages);

		const finalTurnNotice: Message[] = finalTurn
			? [{role: 'user', content: FINAL_TURN_INSTRUCTION}]
			: [];

		let result: Awaited<ReturnType<LLMClient['chat']>>;
		try {
			result = await client.chat(
				[systemMessage, ...cappedMessages, ...finalTurnNotice],
				tools,
				callbacks,
				abortController.signal,
				modeOverrides,
			);
		} catch (error) {
			if (abortController.signal.aborted) {
				session.messages = messages;
				return withTurnUsage({stopReason: 'cancelled'});
			}
			throw error;
		}

		recordUsage(result?.usage);

		if (!result || !result.choices || result.choices.length === 0) {
			return withTurnUsage({stopReason: 'end_turn'});
		}

		const message = result.choices[0].message;
		const nativeToolCalls = message.tool_calls || [];
		const fullContent = message.content || '';

		const xmlParse =
			result.toolsDisabled && !finalTurn
				? parseToolCalls(fullContent)
				: {success: true as const, toolCalls: [], cleanedContent: fullContent};

		if (!xmlParse.success) {
			return withTurnUsage({stopReason: 'end_turn'});
		}

		const allToolCalls: ToolCall[] = [
			...nativeToolCalls,
			...xmlParse.toolCalls,
		];
		const cleanedContent = xmlParse.cleanedContent;

		const partition = partitionUnknownToolCalls(allToolCalls, toolManager);
		const {validToolCalls, errorResults} = partition;
		const {emittedToolCalls, resultsForAbandonedTurn} =
			buildAbandonedTurnMessages(partition);

		messages = [
			...messages,
			{
				role: 'assistant',
				content: cleanedContent,
				tool_calls: emittedToolCalls.length > 0 ? emittedToolCalls : undefined,
				reasoning: streamedReasoning.trim() ? streamedReasoning : undefined,
			},
		];
		// Gate on the same view the next turn will send, so the threshold is not
		// measured against rows the cap already drops from the request.
		const compactGateInput = capMessagesForModel(messages, maxMessages);
		const compacted = await maybeAutoCompact(
			compactGateInput,
			systemMessage,
			client,
			result.toolsDisabled ? undefined : tools,
			{signal: abortController.signal},
		);
		// Only adopt the result when compaction actually ran — otherwise
		// maybeAutoCompact returns the capped view it was handed, and taking it
		// would discard history the cap only meant to hide from one request.
		if (compacted !== compactGateInput) {
			messages = compacted;
		}
		if (abortController.signal.aborted) {
			session.messages = messages;
			return withTurnUsage({stopReason: 'cancelled'});
		}

		if (errorResults.length > 0) {
			messages = [...messages, ...resultsForAbandonedTurn];
			continue;
		}

		if (validToolCalls.length === 0) {
			if (
				developmentMode === 'plan' &&
				!wrotePlan &&
				availableNames.includes('write_plan') &&
				cleanedContent.trim().length > 0
			) {
				const fallbackCall: ToolCall = {
					id: `write-plan-fallback-${session.sessionId}-${turn}`,
					function: {
						name: 'write_plan',
						arguments: {content: cleanedContent},
					},
				};
				const fallbackResult = await executePlanFallback(
					session,
					conn,
					fallbackCall,
				);
				messages = [
					...messages.slice(0, -1),
					{
						...messages[messages.length - 1],
						tool_calls: [fallbackCall],
					},
					fallbackResult,
				];
				wrotePlan = !fallbackResult.isError;
			}

			const fallback = finalTurn
				? null
				: takeWalkthroughFallback(
						walkthroughLifecycle,
						availableNames.includes('write_walkthrough'),
					);
			if (fallback) {
				messages = [...messages, fallback];
				continue;
			}
			session.messages = messages;
			return withTurnUsage({stopReason: 'end_turn'});
		}

		const announcedBatch =
			validToolCalls.length > 1 && !abortController.signal.aborted;
		if (announcedBatch) {
			for (const toolCall of validToolCalls) {
				// withDiff: false - the announcement drops content below, so
				// there is no reason to read the file to build a diff first.
				const queuedMeta = await buildToolCallMeta(toolCall, {
					withDiff: false,
				});
				// Content is withheld until the call is about to run: the client
				// enables its "open diff" affordance off this field, and a diff
				// registered now would be stale by the time the tool executes.
				await emitToolCall(session, conn, toolCall, 'pending', {
					...queuedMeta,
					content: [],
				});
			}
		}

		// Process tool calls
		const toolResults: ToolResult[] = [];
		for (let index = 0; index < validToolCalls.length; index++) {
			const toolCall = validToolCalls[index];
			// Stop was pressed: don't start any remaining queued tools. Record a
			// cancelled result for each so the assistant's tool_calls keep matched
			// results in history; the turn ends below instead of re-prompting.
			if (abortController.signal.aborted) {
				if (announcedBatch) {
					await emitToolCallUpdate(
						session,
						conn,
						toolCall,
						'failed',
						'Cancelled by user',
					);
				}
				toolResults.push({
					tool_call_id: toolCall.id,
					role: 'tool',
					name: toolCall.function.name,
					content: 'Error: cancelled by user',
				});
				continue;
			}

			// Enrich the call with ACP metadata (kind, file locations, and a diff
			// for edits) so the client can render rich tool cards and previews.
			const meta = await buildToolCallMeta(toolCall);

			// Notify client about tool call. Already-announced calls get an
			// update rather than a second tool_call: clients that append on
			// tool_call (instead of upserting by id) would double-render it.
			await emitToolCall(
				session,
				conn,
				toolCall,
				'pending',
				meta,
				announcedBatch ? 'tool_call_update' : 'tool_call',
			);

			// ask_user is interactive: instead of executing it, surface the
			// question's options through the client and feed the choice back as
			// the tool result. We reuse this call's id (just announced) so the
			// permission request targets a known tool call.
			if (toolCall.function.name === 'ask_user') {
				const answer = await handleAskUser(
					session,
					conn,
					toolCall,
					abortController.signal,
				);
				toolResults.push(answer);
				continue;
			}

			// Check if approval is needed. resolveToolApproval is the single
			// authority shared with the interactive loop and plain shell - it
			// applies yolo and the alwaysAllow list internally.
			const needsApproval = await evaluateNeedsApproval(
				toolCall,
				toolManager,
				nonInteractiveAlwaysAllow,
				developmentMode,
			);

			if (needsApproval) {
				const permission = await requestToolPermission(
					session,
					toolCall,
					conn,
					meta,
					abortController.signal,
				);

				if (permission === 'cancelled') {
					await emitToolCallUpdate(
						session,
						conn,
						toolCall,
						'failed',
						'Cancelled by user',
					);
					if (announcedBatch) {
						for (const queued of validToolCalls.slice(index + 1)) {
							await emitToolCallUpdate(
								session,
								conn,
								queued,
								'failed',
								'Cancelled by user',
							);
						}
					}
					toolResults.push(
						...createCancellationResults(validToolCalls.slice(index)),
					);
					session.messages = [...messages, ...toolResults];
					return withTurnUsage({stopReason: 'cancelled'});
				}

				if (permission === 'denied') {
					await emitToolCallUpdate(
						session,
						conn,
						toolCall,
						'failed',
						'Denied by user',
					);
					toolResults.push({
						tool_call_id: toolCall.id,
						role: 'tool',
						name: toolCall.function.name,
						content: 'Tool call denied by user',
					});
					continue;
				}
			}

			// Execute tool
			await emitToolCallUpdate(session, conn, toolCall, 'in_progress');

			const timelineCapture = await beginTimelineCapture(
				session,
				toolManager,
				toolCall,
				messages,
				meta.title,
			);

			let pollInterval: ReturnType<typeof setInterval> | null = null;
			let isPolling = true;
			if (toolCall.function.name === 'agent') {
				// Progress entries are never removed from the map, so snapshot the
				// keys that exist before this call starts and ignore them while
				// polling - otherwise a finished agent from an earlier turn wins the
				// max-token scan and the card shows stale numbers.
				const preexisting = new Set(getAllSubagentProgress().keys());
				pollInterval = setInterval(async () => {
					if (!isPolling) return;
					// agentId is a randomUUID() internal to the executor — not in args.
					// Poll agents started by this call and pick the most active one.
					let best: SubagentEvent | null = null;
					for (const [id, prog] of getAllSubagentProgress()) {
						if (preexisting.has(id)) continue;
						if (!best || prog.tokenCount > best.tokenCount) {
							best = prog;
						}
					}

					if (best) {
						const tokens = Math.floor(best.tokenCount / 1000);
						const lastTool =
							best.toolHistory.length > 0
								? best.toolHistory[best.toolHistory.length - 1]
								: '';

						let title = `${best.subagentName || 'agent'} • ${tokens}k tokens`;
						if (best.toolCallCount > 0) {
							title += ` • ${best.toolCallCount} tools${lastTool ? ` (${lastTool})` : ''}`;
						} else {
							title += ` • thinking...`;
						}

						if (!isPolling) return;
						await emitToolCallUpdate(
							session,
							conn,
							toolCall,
							'in_progress',
							undefined,
							title,
						);
					}
				}, 1500);
			}

			const toolResult = await processToolUse(toolCall, {
				abortSignal: abortController.signal,
				sessionId: session.sessionId,
				workingDirectory: session.cwd,
			});
			await finishTimelineCapture(session, timelineCapture);
			isPolling = false;
			if (pollInterval) clearInterval(pollInterval);

			const status: ToolCallStatus = toolResult.content.startsWith('Error')
				? 'failed'
				: 'completed';
			await emitToolCallUpdate(
				session,
				conn,
				toolCall,
				status,
				toolResult.content,
			);
			toolResults.push(toolResult);
			if (status === 'completed') {
				observeSuccessfulLifecycleTool(walkthroughLifecycle, toolCall);
				if (toolCall.function.name === 'write_plan') {
					wrotePlan = true;
				}
			}

			// write_tasks replaces the whole task list; mirror it to the client
			// as an ACP plan update so GUIs can render a live checklist.
			if (toolCall.function.name === 'write_tasks' && status === 'completed') {
				await emitPlanUpdate(session, conn, toolCall);
			}
		}

		messages = [...messages, ...toolResults];

		// End the turn here when cancelled - without this the loop would issue
		// another LLM request before the top-of-turn abort check runs.
		if (abortController.signal.aborted) {
			session.messages = messages;
			return withTurnUsage({stopReason: 'cancelled'});
		}
	}

	session.messages = messages;
	return withTurnUsage({stopReason: 'max_turn_requests'});
}

async function executePlanFallback(
	session: AcpSession,
	conn: AgentSideConnection,
	toolCall: ToolCall,
): Promise<ToolResult> {
	const meta = await buildToolCallMeta(toolCall);
	await emitToolCall(session, conn, toolCall, 'pending', meta);
	await emitToolCallUpdate(session, conn, toolCall, 'in_progress');
	const result = await processToolUse(toolCall, {
		abortSignal: session.abortController.signal,
		sessionId: session.sessionId,
		workingDirectory: session.cwd,
	});
	await emitToolCallUpdate(
		session,
		conn,
		toolCall,
		result.isError ? 'failed' : 'completed',
		result.content,
	);
	return result;
}

/**
 * Mirror a successful `write_tasks` call to the client as an ACP `plan`
 * session update. The tool's args carry the complete replacement task list
 * (TodoWrite-style), which maps 1:1 onto ACP plan entries; tasks have no
 * priority concept, so entries are reported as `medium`.
 */
async function emitPlanUpdate(
	session: AcpSession,
	conn: AgentSideConnection,
	toolCall: ToolCall,
): Promise<void> {
	const args = toolCall.function.arguments as {
		tasks?: Array<{title?: unknown; status?: unknown}>;
	};
	const tasks = Array.isArray(args?.tasks) ? args.tasks : [];
	const validStatuses = ['pending', 'in_progress', 'completed'] as const;
	const taskArtifactPath = artifactManager.tryGetArtifactPath(
		session.sessionId,
		'task',
	);
	const taskArtifact: ArtifactDescriptor | undefined = taskArtifactPath
		? {kind: 'task', path: taskArtifactPath}
		: undefined;

	await conn.sessionUpdate({
		sessionId: session.sessionId,
		update: {
			sessionUpdate: 'plan',
			_meta: taskArtifact ? {'nanocoder/artifact': taskArtifact} : undefined,
			entries: tasks
				.filter(t => typeof t?.title === 'string')
				.map(t => ({
					content: t.title as string,
					priority: 'medium' as const,
					status: validStatuses.includes(
						t.status as (typeof validStatuses)[number],
					)
						? (t.status as (typeof validStatuses)[number])
						: 'pending',
				})),
		},
	});
}

async function emitToolCall(
	session: AcpSession,
	conn: AgentSideConnection,
	toolCall: ToolCall,
	status: ToolCallStatus,
	meta: AcpToolCallMeta,
	sessionUpdate: 'tool_call' | 'tool_call_update' = 'tool_call',
): Promise<void> {
	// Spelled out per branch: the union of both literals does not narrow
	// SessionUpdate's discriminant.
	const payload = {
		toolCallId: toolCall.id,
		title: meta.title,
		kind: meta.kind,
		rawInput: toolCall.function.arguments,
		status,
		content: meta.content.length > 0 ? meta.content : undefined,
		locations: meta.locations.length > 0 ? meta.locations : undefined,
	};
	await conn.sessionUpdate({
		sessionId: session.sessionId,
		update:
			sessionUpdate === 'tool_call'
				? {...payload, sessionUpdate: 'tool_call'}
				: {...payload, sessionUpdate: 'tool_call_update'},
	});
}

async function emitToolCallUpdate(
	session: AcpSession,
	conn: AgentSideConnection,
	toolCall: ToolCall,
	status: ToolCallStatus,
	rawOutput?: unknown,
	title?: string,
): Promise<void> {
	const artifactKind = ARTIFACT_TOOL_KINDS[toolCall.function.name];
	const artifactPath = artifactKind
		? artifactManager.tryGetArtifactPath(session.sessionId, artifactKind)
		: undefined;
	const artifact: ArtifactDescriptor | undefined =
		status === 'completed' && artifactKind && artifactPath
			? {
					kind: artifactKind,
					path: artifactPath,
				}
			: undefined;
	const meta = artifact
		? {
				'nanocoder/artifact': artifact,
				...(artifact.kind === 'implementation_plan'
					? {'nanocoder/planArtifact': {path: artifact.path}}
					: {}),
			}
		: undefined;

	await conn.sessionUpdate({
		sessionId: session.sessionId,
		update: {
			sessionUpdate: 'tool_call_update',
			toolCallId: toolCall.id,
			status,
			rawOutput,
			title: artifact ? ARTIFACT_TITLES[artifact.kind] : title,
			locations: artifact ? [{path: artifact.path}] : undefined,
			_meta: meta,
		},
	});
}

async function handleAskUser(
	session: AcpSession,
	conn: AgentSideConnection,
	toolCall: ToolCall,
	abortSignal?: AbortSignal,
): Promise<ToolResult> {
	const args = toolCall.function.arguments ?? {};
	const question = typeof args.question === 'string' ? args.question : '';
	const options = normalizeQuestionOptions(args.options);

	let content: string;
	if (!question || options.length < 2 || options.length > 6) {
		content = 'Error: ask_user requires a question and 2-6 string options.';
		await emitToolCallUpdate(session, conn, toolCall, 'failed', content);
	} else {
		await emitToolCallUpdate(session, conn, toolCall, 'in_progress');
		content = await requestUserChoice(
			conn,
			session.sessionId,
			toolCall.id,
			question,
			options,
			abortSignal,
		);
		const status: ToolCallStatus = content.startsWith('Error')
			? 'failed'
			: 'completed';
		await emitToolCallUpdate(session, conn, toolCall, status, content);
	}

	return {
		tool_call_id: toolCall.id,
		role: 'tool',
		name: toolCall.function.name,
		content,
	};
}

/**
 * Coerce the model's `options` into display strings. Most models pass an array
 * of strings, but some send objects (e.g. `{label}`, `{description}`), so we
 * extract a sensible label - via the same `toOptionString` the ask_user tool
 * uses - rather than dropping them and failing the call.
 */
function normalizeQuestionOptions(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.map(toOptionString).filter(option => option.length > 0);
}

async function evaluateNeedsApproval(
	toolCall: ToolCall,
	toolManager: ToolManager,
	nonInteractiveAlwaysAllow: string[],
	mode: DevelopmentMode,
): Promise<boolean> {
	const toolEntry = toolManager.getToolEntry(toolCall.function.name);
	return resolveToolApproval(
		toolCall.function.name,
		toolEntry,
		toolCall.function.arguments,
		{mode, alwaysAllow: nonInteractiveAlwaysAllow},
	);
}
