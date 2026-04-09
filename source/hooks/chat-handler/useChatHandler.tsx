import React from 'react';
import {formatToolsForPrompt} from '@/ai-sdk-client/tools/tool-prompt-formatter';
import {ConversationStateManager} from '@/app/utils/conversation-state';
import UserMessage from '@/components/user-message';
import {getAppConfig} from '@/config/index';
import {CommandIntegration} from '@/custom-commands/command-integration';
import {promptHistory} from '@/prompt-history';
import type {Message} from '@/types/core';
import {MessageBuilder} from '@/utils/message-builder';
import {buildSystemPrompt, setLastBuiltPrompt} from '@/utils/prompt-builder';
import {assemblePrompt} from '@/utils/prompt-processor';
import {processAssistantResponse} from './conversation/conversation-loop';
import {createResetStreamingState} from './state/streaming-state';
import type {ChatHandlerReturn, UseChatHandlerProps} from './types';
import {displayError as displayErrorHelper} from './utils/message-helpers';

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
	getNextComponentKey,
	abortController,
	setAbortController,
	developmentMode = 'normal',
	nonInteractiveMode = false,
	onStartToolConfirmationFlow,
	onConversationComplete,
	compactToolDisplayRef,
	onSetCompactToolCounts,
	compactToolCountsRef,
	onSetLiveTaskList,
	setLiveComponent,
	tune,
}: UseChatHandlerProps): ChatHandlerReturn {
	// Conversation state manager for enhanced context
	const conversationStateManager = React.useRef(new ConversationStateManager());

	// Check if native tool calling is disabled (provider config or tune override)
	const toolsDisabled = React.useMemo(() => {
		if (tune?.enabled && tune.disableNativeTools) return true;
		const config = getAppConfig();
		const provider = config.providers?.find(p => p.name === currentProvider);
		if (!provider) return false;
		return (
			provider.disableTools === true ||
			(provider.disableToolModels?.includes(currentModel) ?? false)
		);
	}, [currentProvider, currentModel, tune]);

	// Cache the base system prompt — only rebuild when mode, tune, tools, or toolsDisabled change
	// This preserves KV cache by keeping the system message stable across turns
	// When native tools are disabled, XML tool definitions are included in the prompt
	// so token counting reflects the full system message the model actually sees.
	const cachedBasePrompt = React.useMemo(() => {
		if (!toolManager) return null;
		const availableNames = toolManager.getAvailableToolNames(
			tune,
			developmentMode,
		);
		let prompt = buildSystemPrompt(
			developmentMode,
			tune,
			availableNames,
			toolsDisabled,
		);

		if (toolsDisabled) {
			const tools = toolManager.getFilteredToolsWithoutExecute(availableNames);
			const toolPrompt = formatToolsForPrompt(tools);
			if (toolPrompt) {
				prompt += toolPrompt;
			}
		}

		// Update the cached prompt so /usage and context % see the full prompt
		setLastBuiltPrompt(prompt);

		return prompt;
	}, [developmentMode, tune, toolManager, toolsDisabled]);

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
	const [tokenCount, setTokenCount] = React.useState<number>(0);

	// Helper to reset all streaming state
	const resetStreamingState = React.useCallback(
		createResetStreamingState(
			setIsCancelling,
			setAbortController,
			setIsGenerating,
			setStreamingContent,
			setTokenCount,
		),
		[], // Setters are stable and don't need to be in dependencies
	);

	// Helper to display errors in chat queue
	const displayError = React.useCallback(
		(error: unknown, keyPrefix: string) => {
			displayErrorHelper(error, keyPrefix, addToChatQueue, getNextComponentKey);
		},
		[addToChatQueue, getNextComponentKey],
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
					setStreamingContent,
					setTokenCount,
					setMessages,
					addToChatQueue,
					getNextComponentKey,
					currentProvider,
					currentModel,
					developmentMode,
					nonInteractiveMode,
					conversationStateManager,
					onStartToolConfirmationFlow,
					onConversationComplete,
					conversationStartTime: conversationStartTimeRef.current,
					compactToolDisplayRef,
					onSetCompactToolCounts,
					compactToolCountsRef,
					onSetLiveTaskList,
					setLiveComponent,
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
			getNextComponentKey,
			currentProvider,
			currentModel,
			developmentMode,
			nonInteractiveMode,
			onStartToolConfirmationFlow,
			onConversationComplete,
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
				key={`user-${getNextComponentKey()}`}
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
			// Use cached base prompt (stable across turns to preserve KV cache)
			let systemPrompt =
				cachedBasePrompt ??
				buildSystemPrompt(
					developmentMode,
					tune,
					toolManager?.getAvailableToolNames(tune, developmentMode) ?? [],
					toolsDisabled,
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
		streamingContent,
		tokenCount,
	};
}
