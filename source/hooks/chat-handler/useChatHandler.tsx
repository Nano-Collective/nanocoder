import React from 'react';
import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {ConversationStateManager} from '@/app/utils/conversation-state';
import {infoMsg} from '@/components/message-factory';
import UserMessage from '@/components/user-message';
import {getAppConfig} from '@/config/index';
import {
	getPreferencesVersion,
	getProfessionalTone,
	getProjectContextPreferences,
	subscribeToPreferences,
} from '@/config/preferences';
import {MessageBuilder} from '@/conversation/message-builder';
import {
	buildSystemPrompt,
	setLastBuiltPrompt,
} from '@/conversation/prompt-builder';
import {CommandIntegration} from '@/custom-commands/command-integration';
import {buildProjectContextSection} from '@/memory/project-context';
import {SemanticMemoryManager} from '@/memory/semantic-memory-manager';
import {processToolUse} from '@/message-handler';
import {appendActivePlanContext} from '@/plans/context';
import {bumpReadContentGeneration} from '@/tools/runtime/read-tracker';
import {getTuneToolMode} from '@/types/config';
import type {ImageAttachment, Message} from '@/types/core';
import {generateKey} from '@/utils/key-generator';
import {getLogger} from '@/utils/logging';
import {appendTurnContext} from '@/utils/turn-context';
import {processAssistantResponse} from './conversation/conversation-loop';
import {createResetStreamingState} from './state/streaming-state';
import type {ChatHandlerReturn, UseChatHandlerProps} from './types';
import {displayError as displayErrorHelper} from './utils/message-helpers';

export function getBaseSystemPrompt(
	developmentMode: UseChatHandlerProps['developmentMode'],
	cachedBasePrompt: string | null,
	toolManager: NonNullable<UseChatHandlerProps['toolManager']>,
	tune: UseChatHandlerProps['tune'],
	toolsDisabled: boolean,
	model?: string,
): string {
	const systemPromptOverride = getAppConfig().systemPrompt;
	if (developmentMode === 'headless') {
		return buildSystemPrompt(
			developmentMode,
			tune,
			toolManager.getAvailableToolNames(
				tune,
				developmentMode,
				undefined,
				model,
			),
			toolsDisabled,
			systemPromptOverride,
			model,
		);
	}

	return (
		cachedBasePrompt ??
		buildSystemPrompt(
			developmentMode ?? 'normal',
			tune,
			toolManager.getAvailableToolNames(
				tune,
				developmentMode ?? 'normal',
				undefined,
				model,
			),
			toolsDisabled,
			systemPromptOverride,
			model,
		)
	);
}

/**
 * Main chat handler hook that manages LLM conversations and tool execution.
 * Orchestrates streaming responses, tool calls, and conversation state.
 */
export function useChatHandler({
	client,
	toolManager,
	customCommandLoader,
	messages,
	setMessages,
	currentProvider,
	currentModel,
	setIsCancelling,
	addToChatQueue,
	setAbortController,
	developmentMode = 'normal',
	developmentModeRef,
	nonInteractiveMode = false,
	onConversationComplete,
	onPlanTurnComplete,
	onArchitectTurnComplete,
	reasoningExpandedRef,
	compactToolDisplayRef,
	onSetCompactToolCounts,
	compactToolCountsRef,
	onSetLiveTaskList,
	setLiveComponent,
	setLastApiUsage,
	onApiCallComplete,
	tune,
	subagentsReady,
	privacySessionMapRef,
	privacyEnabled,
	memoryFinder,
	projectContextOptions,
	ensureCurrentSessionId,
}: UseChatHandlerProps): ChatHandlerReturn {
	// Conversation state manager for enhanced context
	const conversationStateManager = React.useRef(new ConversationStateManager());

	const projectMemoryFinder = React.useMemo(
		() => memoryFinder ?? new SemanticMemoryManager(),
		[memoryFinder],
	);

	// Resolve the active fallback format when native tools are disabled. When
	// native is on, this value is unused. The tune override takes priority over
	// provider-level disables so users can pick the JSON path explicitly even
	// for providers we'd otherwise mark as XML-only.
	const tuneToolMode = React.useMemo(() => getTuneToolMode(tune), [tune]);

	// Check if native tool calling is disabled (provider config or tune override)
	const toolsDisabled = React.useMemo(() => {
		if (tuneToolMode !== 'native') return true;
		const config = getAppConfig();
		const provider = config.providers?.find(p => p.name === currentProvider);
		if (!provider) return false;
		return (
			provider.disableTools === true ||
			(provider.disableToolModels?.includes(currentModel) ?? false)
		);
	}, [currentProvider, currentModel, tuneToolMode]);

	// When native is off, the fallback format is whatever the tune chose; if the
	// disable came from provider config (and tune is on 'native'), default to XML
	// to match historical behaviour.
	const fallbackToolFormat: 'xml' | 'json' =
		tuneToolMode === 'json' ? 'json' : 'xml';

	// Prompt-affecting preferences (Professional Tone) are written straight to
	// disk by the settings panel, so subscribe to those writes explicitly.
	// Without this the memo below only picks the change up on the next mode or
	// model switch, which reads as the toggle silently not working.
	const preferencesVersion = React.useSyncExternalStore(
		subscribeToPreferences,
		getPreferencesVersion,
	);

	// Cache the base system prompt — only rebuild when mode, tune, tools, toolsDisabled
	// or a prompt-affecting preference change
	// This preserves KV cache by keeping the system message stable across turns
	// When native tools are disabled, XML tool definitions are included in the prompt
	// so token counting reflects the full system message the model actually sees.
	// biome-ignore lint/correctness/useExhaustiveDependencies: subagentsReady and preferencesVersion aren't read in the callback, but flipping either must invalidate the memo — subagentsReady so buildSystemPrompt re-reads the module-level subagent cache populated by setAvailableSubagents, preferencesVersion so it re-reads getProfessionalTone().
	const cachedBasePrompt = React.useMemo(() => {
		if (!toolManager) return null;
		const availableNames = toolManager.getAvailableToolNames(
			tune,
			developmentMode,
			undefined,
			currentModel,
		);
		const basePrompt = buildSystemPrompt(
			developmentMode,
			tune,
			availableNames,
			toolsDisabled,
			getAppConfig().systemPrompt,
			currentModel,
			getProfessionalTone(),
			toolManager,
		);

		const tools = toolsDisabled
			? toolManager.getFilteredTools(availableNames)
			: {};
		const prompt = appendToolDefinitionsToPrompt(
			basePrompt,
			toolsDisabled,
			fallbackToolFormat,
			tools,
		);

		// Update the cached prompt so /usage and context % see the full prompt
		setLastBuiltPrompt(prompt);

		return prompt;
	}, [
		developmentMode,
		tune,
		toolManager,
		toolsDisabled,
		fallbackToolFormat,
		subagentsReady,
		currentModel,
		preferencesVersion,
	]);

	// Track when the current conversation started for elapsed time display
	const conversationStartTimeRef = React.useRef<number>(Date.now());

	// Memoize CommandIntegration to avoid recreating on every message
	const commandIntegration = React.useMemo(() => {
		if (!toolManager || !customCommandLoader) return null;
		return new CommandIntegration(customCommandLoader, toolManager);
	}, [toolManager, customCommandLoader]);

	// State for streaming message content
	const [streamingContent, setStreamingContent] = React.useState<string>('');
	const [isGenerating, setIsGenerating] = React.useState<boolean>(false);
	const [streamingReasoning, setStreamingReasoning] =
		React.useState<string>('');
	const [tokenCount, setTokenCount] = React.useState<number>(0);

	// Helper to reset all streaming state
	const resetStreamingState = React.useCallback(
		createResetStreamingState(
			setIsCancelling,
			setAbortController,
			setIsGenerating,
			setStreamingContent,
			setStreamingReasoning,
			setTokenCount,
		),
		[], // Setters are stable and don't need to be in dependencies
	);

	// Helper to display errors in chat queue
	const displayError = React.useCallback(
		(error: unknown, keyPrefix: string) => {
			displayErrorHelper(error, keyPrefix, addToChatQueue);
		},
		[addToChatQueue],
	);

	// Reset conversation state when messages are cleared
	React.useEffect(() => {
		if (messages.length === 0) {
			conversationStateManager.current.reset();
			if (privacySessionMapRef) {
				privacySessionMapRef.current = {};
			}
		}
	}, [messages.length, privacySessionMapRef]);

	// Wrapper for processAssistantResponse that includes error handling
	const processAssistantResponseWithErrorHandling = React.useCallback(
		async (
			systemMessage: Message,
			msgs: Message[],
			sessionId?: string,
			onToolExecuted?: (toolName: string) => void,
			onFinalAssistantText?: (content: string) => void,
			architectCheckpointState?: {
				created: boolean;
				name?: string;
			},
			// The turn's controller, passed by the caller that created it. Reading
			// the `abortController` prop here instead would see the value from the
			// render this callback was memoised in - usually null, since the
			// caller's setAbortController has not re-rendered yet - and the loop
			// would mint a second controller that the caller's abort checks never
			// see.
			turnController?: AbortController,
		) => {
			if (!client) return;

			try {
				await processAssistantResponse({
					systemMessage,
					messages: msgs,
					client,
					toolManager,
					abortController: turnController ?? null,
					setAbortController,
					setIsGenerating,
					setStreamingReasoning,
					setStreamingContent,
					setTokenCount,
					setMessages,
					addToChatQueue,
					currentProvider,
					currentModel,
					developmentMode,
					developmentModeRef,
					nonInteractiveMode,
					conversationStateManager,
					architectCheckpointState,
					onConversationComplete,
					conversationStartTime: conversationStartTimeRef.current,
					reasoningExpandedRef,
					compactToolDisplayRef,
					onSetCompactToolCounts,
					compactToolCountsRef,
					onSetLiveTaskList,
					setLiveComponent,
					setLastApiUsage,
					onApiCallComplete,
					tune,
					privacySessionMapRef,
					privacyEnabled,
					sessionId,
					workingDirectory: process.cwd(),
					onToolExecuted,
					onFinalAssistantText,
					onPrivacyEvent: (count: number) => {
						// `count` is the number of NEW identifiers scrubbed on this turn
						// (the per-turn delta), not a session running total.
						addToChatQueue(
							infoMsg(
								`Privacy active: scrubbed ${count} new identifier${count === 1 ? '' : 's'}`,
								'privacy',
							),
						);
					},
				});
			} catch (error) {
				displayError(error, 'chat-error');
				// Signal completion on error to avoid hanging in non-interactive mode
				onConversationComplete?.();
			} finally {
				resetStreamingState();
			}
		},
		[
			client,
			toolManager,
			setAbortController,
			setMessages,
			addToChatQueue,
			currentProvider,
			currentModel,
			developmentMode,
			developmentModeRef,
			nonInteractiveMode,
			onConversationComplete,
			reasoningExpandedRef,
			compactToolDisplayRef,
			compactToolCountsRef,
			onSetCompactToolCounts,
			onSetLiveTaskList,
			tune,
			displayError,
			resetStreamingState,
			setLiveComponent,
			setLastApiUsage,
			onApiCallComplete,
			privacySessionMapRef,
			privacyEnabled,
		],
	);

	// Handle chat message processing
	const handleChatMessage = async (
		message: string,
		displayValue?: string,
		images?: ImageAttachment[],
		historyMessages?: Message[],
		replaceFrom?: number,
	) => {
		if (!client || !toolManager) {
			// handleMessageSubmit marks a turn as incomplete before reaching this
			// hook. Signal completion here as well so an unavailable setup cannot
			// leave the queue blocked forever.
			onConversationComplete?.();
			return;
		}
		const sessionId = ensureCurrentSessionId?.();
		let wrotePlan = false;
		let finalAssistantText = '';

		// Lifetime /stats: count each user turn (fire-and-forget).
		try {
			const {recordUserPrompt} = await import('@/stats/record');
			recordUserPrompt(currentProvider, currentModel);
		} catch {
			// Stats must never block chat.
		}

		// Record conversation start time for elapsed time display
		conversationStartTimeRef.current = Date.now();

		// The submit chain hands us the display version (with [@file]
		// placeholders) alongside the fully assembled message. Use it directly
		// for the bubble; fall back to the raw message for callers that have no
		// placeholder view (custom commands, VS Code prompts).
		const displayMessage = displayValue ?? message;

		// Add user message to chat using display version (with placeholders)
		// Pass the full assembled message for accurate token counting.
		//
		// Queued before the per-turn context below, which awaits a semantic
		// memory search: the bubble must echo immediately, not after a disk
		// round-trip. The block it omits is counted in the status-line context
		// %, which measures the message array rather than this bubble.
		addToChatQueue(
			<UserMessage
				key={generateKey('user')}
				message={displayMessage}
				tokenContent={message}
				imageCount={images?.length ?? 0}
			/>,
		);

		// Create abort controller for cancellation. This is the turn's only
		// controller: it is handed to the conversation loop explicitly, so the
		// one Escape aborts (app state) is the one the checks below read.
		//
		// Created before the per-turn context below, which awaits a semantic
		// memory search: Escape pressed during that search has to land on this
		// turn's controller, or the turn would go on to call the model with a
		// signal nobody can abort.
		const controller = new AbortController();
		setAbortController(controller);

		// Per-turn context (skills matched for this request, memories recalled
		// for it) rides at the end of the user message rather than being
		// appended to the system prompt, so the system block stays byte-stable
		// for the session and history remains append-only (#1574).
		//
		// Best-effort, matching the recall below: context is an optimization, so
		// a broken skills loader degrades this turn instead of failing it.
		let skillsSection = '';
		try {
			skillsSection = commandIntegration?.buildSkillsSection(message) ?? '';
		} catch (error) {
			getLogger().warn({error}, 'Failed to build the skills section');
		}
		const projectContext = await buildProjectContextSection(
			message,
			projectMemoryFinder,
			// Preferences supply the defaults; an explicit prop still wins so
			// callers (and tests) can override per session.
			{...getProjectContextPreferences(), ...projectContextOptions},
		);
		const messageWithContext = appendTurnContext(message, [
			skillsSection,
			projectContext.content,
			replaceFrom === undefined
				? undefined
				: '[Retry: Any file edits from the previous attempt are still on disk. Reread files before editing and check which changes have already been applied.]',
		]);

		if (projectContext.memoryCount > 0) {
			addToChatQueue(
				infoMsg(
					`Recalling ${projectContext.memoryCount} project memor${projectContext.memoryCount === 1 ? 'y' : 'ies'}...`,
					'memory-recall',
				),
			);
		}

		// Add user message to conversation history (single addition). Any
		// caller-supplied historyMessages (e.g. the preceding turns of a
		// multi-message MCP prompt) are spliced in first, preserving their
		// original roles, so a few-shot prompt keeps its turn structure
		// instead of being flattened into this one user message. A retry replaces
		// the discarded tail in the same update that adds the replacement prompt.
		const builder = new MessageBuilder(
			replaceFrom === undefined ? messages : messages.slice(0, replaceFrom),
		);
		for (const historyMessage of historyMessages ?? []) {
			builder.addMessage(historyMessage);
		}
		builder.addUserMessage(messageWithContext, images);
		const updatedMessages = builder.build();
		if (replaceFrom !== undefined) bumpReadContentGeneration();
		setMessages(updatedMessages);

		// Initialize conversation state if this is a new conversation
		if (messages.length === 0) {
			conversationStateManager.current.initializeState(message);
		}

		// Keep Architect checkpoint state for the entire user turn.
		const architectCheckpointState: {
			created: boolean;
			name?: string;
		} = {
			created: false,
		};

		try {
			// Skills and recalled memories are no longer appended here: they
			// travel in the user message (see above), which is what makes the
			// memo's "stable across turns" claim actually hold. The persisted
			// plan block below is the one remaining per-turn addition.
			let systemPrompt = getBaseSystemPrompt(
				developmentMode,
				cachedBasePrompt,
				toolManager,
				tune,
				toolsDisabled,
				currentModel,
			);

			// Persisted plan state changes between turns and must be visible after
			// a restart, so it is appended here rather than baked into the cached
			// base prompt. It costs the prefix on every turn of a session with an
			// active plan — the same cost #1574 removes for skills and memories —
			// but moving it is out of scope here, so it keeps main's behaviour.
			//
			// Published after the append, not before: the memo publishes the base
			// prompt, and the context % has to measure what is actually sent. The
			// moved skills/memory block is not double-counted, since it now lives
			// in the message array the indicator already sums.
			systemPrompt = await appendActivePlanContext(systemPrompt);
			setLastBuiltPrompt(systemPrompt);

			// Create stream request
			const systemMessage: Message = {
				role: 'system',
				content: systemPrompt,
			};

			// Use the conversation loop
			await processAssistantResponseWithErrorHandling(
				systemMessage,
				updatedMessages,
				sessionId,
				toolName => {
					if (toolName === 'write_plan') wrotePlan = true;
				},
				content => {
					finalAssistantText = content;
				},
				architectCheckpointState,
				controller,
			);

			if (
				developmentMode === 'plan' &&
				!wrotePlan &&
				!controller.signal.aborted &&
				finalAssistantText.trim()
			) {
				const fallbackResult = await processToolUse(
					{
						id: 'write-plan-fallback',
						function: {
							name: 'write_plan',
							arguments: {content: finalAssistantText},
						},
					},
					{
						abortSignal: controller.signal,
						sessionId,
						workingDirectory: process.cwd(),
					},
				);
				if (fallbackResult.isError) {
					displayError(new Error(fallbackResult.content), 'plan-fallback');
				} else {
					wrotePlan = true;
				}
			}

			// If this turn STARTED in plan mode (closure value, captured at submit
			// time) and ran to completion without being interrupted, a plan was
			// actually produced — signal the plan review bar. Deciding here, with
			// the start mode and the abort signal both in hand, avoids the race
			// where toggling modes mid-generation makes an unrelated completing turn
			// look like a finished plan.
			if (
				developmentMode === 'plan' &&
				wrotePlan &&
				!controller.signal.aborted
			) {
				onPlanTurnComplete?.();
			}

			if (
				developmentMode === 'architect' &&
				architectCheckpointState.created &&
				architectCheckpointState.name &&
				!controller.signal.aborted
			) {
				onArchitectTurnComplete?.(architectCheckpointState.name);
			}
		} catch (error) {
			displayError(error, 'chat-error');
			onConversationComplete?.();
		} finally {
			resetStreamingState();
		}
	};

	return {
		handleChatMessage,
		processAssistantResponse: processAssistantResponseWithErrorHandling,
		isGenerating,
		streamingReasoning,
		streamingContent,
		tokenCount,
	};
}
