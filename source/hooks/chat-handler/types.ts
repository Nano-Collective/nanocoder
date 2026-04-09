import type React from 'react';
import type {CustomCommandLoader} from '@/custom-commands/loader';
import type {Task} from '@/tools/tasks/types';
import type {ToolManager} from '@/tools/tool-manager';
import type {TuneConfig} from '@/types/config';
import type {LLMClient, Message, ToolCall} from '@/types/core';

export interface UseChatHandlerProps {
	client: LLMClient | null;
	toolManager: ToolManager | null;
	customCommandLoader: CustomCommandLoader | null;
	messages: Message[];
	setMessages: (messages: Message[]) => void;
	currentProvider: string;
	currentModel: string;
	setIsCancelling: (cancelling: boolean) => void;

	addToChatQueue: (component: React.ReactNode) => void;
	getNextComponentKey: () => number;
	abortController: AbortController | null;
	setAbortController: (controller: AbortController | null) => void;
	developmentMode?: 'normal' | 'auto-accept' | 'yolo' | 'plan' | 'scheduler';
	nonInteractiveMode?: boolean;
	onStartToolConfirmationFlow: (
		toolCalls: ToolCall[],
		updatedMessages: Message[],
		assistantMsg: Message,
		systemMessage: Message,
	) => void;
	onConversationComplete?: () => void;
	compactToolDisplayRef?: React.RefObject<boolean>;
	onSetCompactToolCounts?: (counts: Record<string, number> | null) => void;
	compactToolCountsRef?: React.MutableRefObject<Record<string, number>>;
	onSetLiveTaskList?: (tasks: Task[] | null) => void;
	setLiveComponent?: (component: React.ReactNode) => void;
	tune?: TuneConfig;
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
