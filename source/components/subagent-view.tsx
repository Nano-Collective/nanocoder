import {Box, Text, useInput} from 'ink';
import React, {useEffect, useReducer} from 'react';
import AssistantMessage from '@/components/assistant-message';
import ChatQueue from '@/components/chat-queue';
import StreamingMessage from '@/components/streaming-message';
import StreamingReasoning from '@/components/streaming-reasoning';
import ToolMessage from '@/components/tool-message';
import UserMessage from '@/components/user-message';
import {useTheme} from '@/hooks/useTheme';
import {getSubagentSession} from '@/services/subagent-session-store';

interface SubagentViewProps {
	agentId: string;
	onDetach: () => void;
	reasoningExpanded: boolean;
	altScreenActive?: boolean;
}

export function SubagentView({
	agentId,
	onDetach,
	reasoningExpanded,
	altScreenActive = false,
}: SubagentViewProps) {
	const {colors} = useTheme();
	const [, forceRender] = useReducer((x: number) => x + 1, 0);

	// Poll the mutable session store every 100ms for updates
	useEffect(() => {
		const interval = setInterval(() => forceRender(), 100);
		return () => clearInterval(interval);
	}, []);

	useInput((_input, key) => {
		if (key.escape) {
			onDetach();
		}
	});

	const session = getSubagentSession(agentId);

	// Automatically detach if session cleans up or completes
	// This happens when subagent finishes running and executor cleans it up.
	useEffect(() => {
		if (!session) {
			onDetach();
		}
	}, [session, onDetach]);

	if (!session) {
		return null;
	}

	const chatComponents = session.messages
		.map((msg, index) => {
			if (msg.role === 'user') {
				return <UserMessage key={`user-${index}`} message={msg.content} />;
			}
			if (msg.role === 'assistant' && msg.content) {
				return (
					<AssistantMessage
						key={`assistant-${index}`}
						message={msg.content}
						model="subagent"
					/>
				);
			}
			if (msg.role === 'tool') {
				return (
					<ToolMessage
						key={`tool-${index}`}
						message={`⚒ ${msg.name}: ${msg.content.slice(0, 100)}...`}
						hideBox={true}
					/>
				);
			}
			return null;
		})
		.filter(Boolean);

	const liveComponent =
		session.streamingText || session.streamingReasoning ? (
			<React.Fragment>
				{session.streamingReasoning && !session.streamingText && (
					<StreamingReasoning
						reasoning={session.streamingReasoning}
						expand={reasoningExpanded}
					/>
				)}
				{session.streamingReasoning && session.streamingText && (
					<AssistantMessage
						message={`[Reasoning complete]\n${session.streamingReasoning}`}
						model="subagent"
					/>
				)}
				{session.streamingText && (
					<StreamingMessage message={session.streamingText} model="subagent" />
				)}
			</React.Fragment>
		) : null;

	return (
		<Box flexDirection="column" flexGrow={1} height="100%">
			<Box
				paddingX={1}
				borderBottomColor={colors.secondary}
				borderStyle="single"
				borderTop={false}
				borderLeft={false}
				borderRight={false}
			>
				<Text color={colors.secondary}>Main Session &gt; </Text>
				<Text color={colors.primary} bold>
					{session.subagentName}
				</Text>
				<Box flexGrow={1} />
				<Text color={colors.secondary}>Press Esc to detach</Text>
			</Box>

			<Box flexGrow={1} flexDirection="column">
				<ChatQueue
					staticComponents={[]}
					queuedComponents={chatComponents}
					disableStatic={altScreenActive}
					renderLastQueuedComponentLive={false}
				/>
				{liveComponent && (
					<Box paddingX={1} flexDirection="column">
						{liveComponent}
					</Box>
				)}
			</Box>
		</Box>
	);
}
