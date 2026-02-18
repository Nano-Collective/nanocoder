import type React from 'react';
import type {ToolManager} from '@/tools/tool-manager';
import type {LLMClient, Message, ToolCall} from '@/types/core';

export interface UseChatHandlerProps {
	client: LLMClient | null;
	toolManager: ToolManager | null;
	messages: Message[];
	setMessages: (messages: Message[]) => void;
	currentProvider: string;
	currentModel: string;
	setIsCancelling: (cancelling: boolean) => void;

	addToChatQueue: (component: React.ReactNode) => void;
	getNextComponentKey: () => number;
	abortController: AbortController | null;
	setAbortController: (controller: AbortController | null) => void;
	developmentMode?: 'normal' | 'auto-accept' | 'plan' | 'scheduler';
	nonInteractiveMode?: boolean;
	onStartToolConfirmationFlow: (
		toolCalls: ToolCall[],
		updatedMessages: Message[],
		assistantMsg: Message,
		systemMessage: Message,
	) => void;
	onConversationComplete?: () => void;
}

export interface ChatHandlerReturn {
	handleChatMessage: (message: string) => Promise<void>;
	processAssistantResponse: (
		systemMessage: Message,
		messages: Message[],
	) => Promise<void>;
	isGenerating: boolean;
	streamingContent: string;
	tokenCount: number;
}
