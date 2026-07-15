import {ReactNode} from 'react';

export interface AssistantMessageProps {
	message: string;
	model: string;
}

export interface AssistantReasoningProps {
	reasoning: string;
	expand: boolean;
}

export interface ChatQueueProps {
	staticComponents?: ReactNode[];
	queuedComponents?: ReactNode[];
	renderLastQueuedComponentLive?: boolean;
	clearKey?: string;
	/**
	 * Render everything in regular flow instead of Ink's Static. Used by the
	 * fullscreen (alternate-screen) layout, where Static has no scrollback
	 * to print into. Only a bounded tail of components is rendered.
	 */
	disableStatic?: boolean;
}

export type Completion = {name: string; isCustom: boolean};

export interface ToolExecutionIndicatorProps {
	toolName: string;
	currentIndex: number;
	totalTools: number;
}

export interface UserMessageProps {
	message: string;
	tokenContent?: string; // Full assembled content for accurate token counting
	imageCount?: number; // Number of image attachments sent with this message
}
