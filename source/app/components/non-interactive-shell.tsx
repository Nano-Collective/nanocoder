import {Box} from 'ink';
import React from 'react';
import {ChatHistory} from '@/app/components/chat-history';
import {NonInteractiveStatus} from '@/app/components/non-interactive-status';
import {NonInteractiveRenderContext} from '@/hooks/useNonInteractiveRender';

export interface NonInteractiveShellProps {
	/** Whether the chat has started (transcript is ready to display) */
	startChat: boolean;
	/** Frozen static transcript (past messages) */
	staticComponents: React.ReactNode[];
	/** Queued components appended during the run */
	queuedComponents: React.ReactNode[];
	/** Live component (streaming message, tool progress) rendered below the transcript */
	liveComponent?: React.ReactNode;
	/**
	 * Status line. Null signals the run is complete and about to exit.
	 */
	statusMessage: string | null;
}

/**
 * Minimal Ink shell used for `run` (non-interactive) mode.
 *
 * Renders only the transcript plus a single status line. Deliberately
 * excludes ChatInput, modal selectors, the file explorer, the IDE selector,
 * the scheduler view, and any other interactive-only surface.
 *
 * Provides NonInteractiveRenderContext to its subtree so shared message
 * components (AssistantMessage, UserMessage, StreamingMessage, etc.) can
 * drop boxes/headers/token counters and render plain text.
 */
export function NonInteractiveShell({
	startChat,
	staticComponents,
	queuedComponents,
	liveComponent,
	statusMessage,
}: NonInteractiveShellProps): React.ReactElement {
	return (
		<NonInteractiveRenderContext.Provider value={true}>
			<Box flexDirection="column" paddingX={1} width="100%">
				<ChatHistory
					startChat={startChat}
					staticComponents={staticComponents}
					queuedComponents={queuedComponents}
					liveComponent={liveComponent}
				/>
				<NonInteractiveStatus message={statusMessage} />
			</Box>
		</NonInteractiveRenderContext.Provider>
	);
}
