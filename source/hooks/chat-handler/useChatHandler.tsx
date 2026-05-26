import React from 'react';
import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {ConversationStateManager} from '@/app/utils/conversation-state';
import UserMessage from '@/components/user-message';
import {getAppConfig, getLocalModelWorkflowConfig} from '@/config/index';
import {CommandIntegration} from '@/custom-commands/command-integration';
import {promptHistory} from '@/prompt-history';
import {
	CATEGORY_TOOL_SETS,
	classifyMessage,
	type SpecialistCategory,
	shouldActivateRouter,
} from '@/router';
import {generateKey} from '@/session/key-generator';
import {getTuneToolMode} from '@/types/config';
import type {Message} from '@/types/core';
import {getLogger} from '@/utils/logging';
import {MessageBuilder} from '@/utils/message-builder';
import {buildSystemPrompt, setLastBuiltPrompt} from '@/utils/prompt-builder';
import {assemblePrompt} from '@/utils/prompt-processor';
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
	routerOverrideTools?: string[],
): string {
	const systemPromptOverride = getAppConfig().systemPrompt;

	// When the router has classified the message into a specialist
	// category, use the filtered tool list instead of the full set.
	const effectiveToolNames =
		routerOverrideTools ??
		toolManager.getAvailableToolNames(tune, developmentMode);

	if (developmentMode === 'headless') {
		return buildSystemPrompt(
			developmentMode,
			tune,
			effectiveToolNames,
			toolsDisabled,
			systemPromptOverride,
		);
	}

	// When the router provides an override, always rebuild — the cached
	// prompt was built with the full tool set and would ignore the filter.
	if (routerOverrideTools !== undefined) {
		return buildSystemPrompt(
			developmentMode ?? 'normal',
			tune,
			effectiveToolNames,
			toolsDisabled,
			systemPromptOverride,
		);
	}

	return (
		cachedBasePrompt ??
		buildSystemPrompt(
			developmentMode ?? 'normal',
			tune,
			effectiveToolNames,
			toolsDisabled,
			systemPromptOverride,
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
	abortController,
	setAbortController,
	developmentMode = 'normal',
	nonInteractiveMode = false,
	onStartToolConfirmationFlow,
	onConversationComplete,
	reasoningExpandedRef,
	compactToolDisplayRef,
	onSetCompactToolCounts,
	compactToolCountsRef,
	onSetLiveTaskList,
	setLiveComponent,
	tune,
	subagentsReady,
}: UseChatHandlerProps): ChatHandlerReturn {
	// Conversation state manager for enhanced context
	const conversationStateManager = React.useRef(new ConversationStateManager());

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

	// Cache the base system prompt — only rebuild when mode, tune, tools, or toolsDisabled change
	// This preserves KV cache by keeping the system message stable across turns
	// When native tools are disabled, XML tool definitions are included in the prompt
	// so token counting reflects the full system message the model actually sees.
	// biome-ignore lint/correctness/useExhaustiveDependencies: subagentsReady isn't read in the callback, but flipping it must invalidate the memo so buildSystemPrompt re-reads the module-level subagent cache populated by setAvailableSubagents.
	const cachedBasePrompt = React.useMemo(() => {
		if (!toolManager) return null;
		const availableNames = toolManager.getAvailableToolNames(
			tune,
			developmentMode,
		);
		const basePrompt = buildSystemPrompt(
			developmentMode,
			tune,
			availableNames,
			toolsDisabled,
			getAppConfig().systemPrompt,
		);

		const tools = toolsDisabled
			? toolManager.getFilteredToolsWithoutExecute(availableNames)
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
	]);

	// Track when the current conversation started for elapsed time display
	const conversationStartTimeRef = React.useRef<number>(Date.now());

	// Track the previous specialist category for sticky routing.
	// Resets when messages are cleared.
	const previousCategoryRef = React.useRef<SpecialistCategory | undefined>(
		undefined,
	);

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
			previousCategoryRef.current = undefined;
		}
	}, [messages.length]);

	// Wrapper for processAssistantResponse that includes error handling
	const processAssistantResponseWithErrorHandling = React.useCallback(
		async (
			systemMessage: Message,
			msgs: Message[],
			routerOverrideTools?: string[],
		) => {
			if (!client) return;

			try {
				await processAssistantResponse({
					systemMessage,
					messages: msgs,
					client,
					toolManager,
					abortController,
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
					nonInteractiveMode,
					conversationStateManager,
					onStartToolConfirmationFlow,
					onConversationComplete,
					conversationStartTime: conversationStartTimeRef.current,
					reasoningExpandedRef,
					compactToolDisplayRef,
					onSetCompactToolCounts,
					compactToolCountsRef,
					onSetLiveTaskList,
					setLiveComponent,
					tune,
					routerOverrideTools,
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
			abortController,
			setAbortController,
			setMessages,
			addToChatQueue,
			currentProvider,
			currentModel,
			developmentMode,
			nonInteractiveMode,
			onStartToolConfirmationFlow,
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
		],
	);

	// Handle chat message processing
	const handleChatMessage = async (message: string) => {
		if (!client || !toolManager) return;

		// Record conversation start time for elapsed time display
		conversationStartTimeRef.current = Date.now();

		// ── Router classification for local models ────────────
		// When a local provider is active, classify the message into a
		// specialist category and filter the tool set accordingly.
		let routerOverrideTools: string[] | undefined;

		const workflowConfig = getLocalModelWorkflowConfig();
		if (
			shouldActivateRouter(
				workflowConfig.enabled,
				workflowConfig.activateForLocalProviders,
				currentProvider,
			)
		) {
			try {
				const routerConfig = workflowConfig.router ?? {};
				// Only use model classification when a dedicated router model
				// is explicitly configured. Without it, the router would call
				// the same heavy model for classification — adding latency
				// for no benefit. Keyword + pre-model tiers are fast and free.
				const routerModel = routerConfig.model ?? '';
				const timeout = routerConfig.timeout ?? 2000;

				const result = await classifyMessage(
					message,
					previousCategoryRef.current,
					{
						model: routerModel,
						timeout,
						defaultCategory:
							(routerConfig.defaultCategory as
								| SpecialistCategory
								| undefined) ?? 'chat',
						categories: {},
					},
				);

				previousCategoryRef.current = result.category;

				// 'multi' gets the full tool set
				const toolSet = CATEGORY_TOOL_SETS[result.category];
				if (toolSet && toolSet.length > 0) {
					routerOverrideTools = toolSet;
				}
				// 'chat' gets no tools — pure conversation
				if (result.category === 'chat') {
					routerOverrideTools = [];
				}

				getLogger().info('[Router] Classified message', {
					category: result.category,
					confidence: result.confidence,
					snippet: message.slice(0, 80),
					toolsCount: routerOverrideTools?.length ?? 'all',
				});
			} catch {
				// Router failure is non-fatal — fall through to full tool set
			}
		}

		// For display purposes, try to get the placeholder version from history
		// This preserves the nice placeholder display in chat history
		// Only use history entry if the assembled prompt matches the current message
		// (VS Code prompts bypass history, so we shouldn't use stale history entries)
		const history = promptHistory.getHistory();
		const lastEntry = history[history.length - 1];
		const assembledFromHistory = lastEntry
			? assemblePrompt(lastEntry)
			: undefined;
		const displayMessage =
			assembledFromHistory === message ? lastEntry.displayValue : message;

		// Add user message to chat using display version (with placeholders)
		// Pass the full assembled message for accurate token counting
		addToChatQueue(
			<UserMessage
				key={generateKey('user')}
				message={displayMessage}
				tokenContent={message}
			/>,
		);

		// Add user message to conversation history (single addition)
		const builder = new MessageBuilder(messages);
		builder.addUserMessage(message);
		const updatedMessages = builder.build();
		setMessages(updatedMessages);

		// Initialize conversation state if this is a new conversation
		if (messages.length === 0) {
			conversationStateManager.current.initializeState(message);
		}

		// Create abort controller for cancellation
		const controller = new AbortController();
		setAbortController(controller);

		try {
			let systemPrompt = getBaseSystemPrompt(
				developmentMode,
				cachedBasePrompt,
				toolManager,
				tune,
				toolsDisabled,
				routerOverrideTools,
			);

			// Enhance with relevant commands (progressive disclosure)
			if (commandIntegration) {
				systemPrompt = commandIntegration.enhanceSystemPrompt(
					systemPrompt,
					message,
				);
			}

			// Create stream request
			const systemMessage: Message = {
				role: 'system',
				content: systemPrompt,
			};

			// Use the conversation loop
			await processAssistantResponseWithErrorHandling(
				systemMessage,
				updatedMessages,
				routerOverrideTools,
			);
		} catch (error) {
			displayError(error, 'chat-error');
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
