import type React from 'react';
import type {CustomCommandLoader} from '@/custom-commands/loader';
import type {Task} from '@/tools/tasks/types';
import type {ToolManager} from '@/tools/tool-manager';
import type {TuneConfig} from '@/types/config';
import type {
	ApiCallRecord,
	ApiUsageSnapshot,
	ImageAttachment,
	LLMClient,
	Message,
} from '@/types/core';

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
	abortController: AbortController | null;
	setAbortController: (controller: AbortController | null) => void;
	developmentMode?: 'normal' | 'auto-accept' | 'yolo' | 'plan' | 'headless';
	// Live mode ref so the conversation loop can read mode changes mid-turn.
	developmentModeRef?: React.RefObject<
		'normal' | 'auto-accept' | 'yolo' | 'plan' | 'headless'
	>;
	nonInteractiveMode?: boolean;
	onConversationComplete?: () => void;
	reasoningExpandedRef?: React.RefObject<boolean>;
	compactToolDisplayRef?: React.RefObject<boolean>;
	onSetCompactToolCounts?: (counts: Record<string, number> | null) => void;
	compactToolCountsRef?: React.MutableRefObject<Record<string, number>>;
	onSetLiveTaskList?: (tasks: Task[] | null) => void;
	setLiveComponent?: (component: React.ReactNode) => void;
	// Records the API-reported usage of the latest response for the context
	// indicator (null clears it, e.g. after auto-compaction).
	setLastApiUsage?: (usage: ApiUsageSnapshot | null) => void;
	// Pushes a per-call usage record after each successful API response so the
	// /usage command can compute accurate per-provider costs from real tokens.
	onApiCallComplete?: (record: ApiCallRecord) => void;
	tune?: TuneConfig;
	// Flips true after subagent loading completes; used to invalidate the
	// cached system prompt so it includes the real agent list.
	subagentsReady?: boolean;
}

export interface ChatHandlerReturn {
	handleChatMessage: (
		message: string,
		displayValue?: string,
		images?: ImageAttachment[],
	) => Promise<void>;
	processAssistantResponse: (
		systemMessage: Message,
		messages: Message[],
	) => Promise<void>;
	isGenerating: boolean;
	streamingReasoning: string;
	streamingContent: string;
	tokenCount: number;
}
