import {ReactNode} from 'react';
import type {ResponseUsage} from './usage';

export interface AssistantMessageProps {
	message: string;
	model: string;
	/**
	 * Provider-reported usage (+ estimated cost) for the API call that
	 * produced this message. When absent, the footer falls back to a
	 * client-side token estimate of the message text.
	 */
	usage?: ResponseUsage;
	/**
	 * Whether to render the gray usage footer at all. Defaults to true;
	 * set false by the `showUsageFooter` user preference, which drops the
	 * footer line (both the provider-reported form and the estimate).
	 */
	showUsageFooter?: boolean;
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
	/**
	 * Left indent applied to every rendered item, so callers can line the
	 * transcript up with some other left edge (e.g. the main chat's input
	 * box). Defaults to 0 — callers with no such reference (e.g. the subagent
	 * detail view) get the original flush-left layout.
	 */
	leftMargin?: number;
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
