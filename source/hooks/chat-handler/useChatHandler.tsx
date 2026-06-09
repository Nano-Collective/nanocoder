import React from 'react';
import {appendToolDefinitionsToPrompt} from '@/ai-sdk-client/tools/system-prompt-assembler';
import {ConversationStateManager} from '@/app/utils/conversation-state';
import UserMessage from '@/components/user-message';
import {getAppConfig} from '@/config/index';
import {CommandIntegration} from '@/custom-commands/command-integration';
import {generateKey} from '@/session/key-generator';
import {getTuneToolMode} from '@/types/config';
import type {Message} from '@/types/core';
import {MessageBuilder} from '@/utils/message-builder';
import {buildSystemPrompt, setLastBuiltPrompt} from '@/utils/prompt-builder';
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
	abortController,
	setAbortController,
	developmentMode = 'normal',
	developmentModeRef,
	nonInteractiveMode = false,
	onConversationComplete,
	reasoningExpandedRef,
	compactToolDisplayRef,
	onSetCompactToolCounts,
	compactToolCountsRef,
	onSetLiveTaskList,
	setLiveComponent,
	setLastApiUsage,
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
		}
	}, [messages.length]);

	// Wrapper for processAssistantResponse that includes error handling
	const processAssistantResponseWithErrorHandling = React.useCallback(
		async (systemMessage: Message, msgs: Message[]) => {
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
					developmentModeRef,
					nonInteractiveMode,
					conversationStateManager,
					onConversationComplete,
					conversationStartTime: conversationStartTimeRef.current,
					reasoningExpandedRef,
					compactToolDisplayRef,
					onSetCompactToolCounts,
					compactToolCountsRef,
					onSetLiveTaskList,
					setLiveComponent,
					setLastApiUsage,
					tune,
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
		],
	);

	// Handle chat message processing
	const handleChatMessage = async (message: string, displayValue?: string) => {
		if (!client || !toolManager) return;

		// Record conversation start time for elapsed time display
		conversationStartTimeRef.current = Date.now();

		// The submit chain hands us the display version (with [@file]
		// placeholders) alongside the fully assembled message. Use it directly
		// for the bubble; fall back to the raw message for callers that have no
		// placeholder view (custom commands, VS Code prompts).
		const displayMessage = displayValue ?? message;

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
				currentModel,
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
