import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import React, {useEffect, useState} from 'react';
import type {SessionMetadata} from '@/session/session-manager';
import {sessionManager} from '@/session/session-manager';

interface SessionSelectorProps {
	onSelect: (session: SessionMetadata | null) => void;
	onCancel: () => void;
}

export function formatTimeAgo(dateString: string): string {
	const date = new Date(dateString);
	const now = new Date();
	const diffInMs = now.getTime() - date.getTime();
	const diffInMinutes = diffInMs / (1000 * 60);
	const diffInHours = diffInMinutes / 60;
	const diffInDays = diffInHours / 24;

	if (diffInMinutes < 5) {
		return 'just now';
	} else if (diffInMinutes < 60) {
		const minutes = Math.floor(diffInMinutes);
		return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
	} else if (diffInHours < 24) {
		const hours = Math.floor(diffInHours);
		return `${hours} hour${hours > 1 ? 's' : ''} ago`;
	} else if (diffInDays < 7) {
		const days = Math.floor(diffInDays);
		return `${days} day${days > 1 ? 's' : ''} ago`;
	} else {
		const weeks = Math.floor(diffInDays / 7);
		return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
	}
}

export function formatMessageCount(count: number): string {
	return `${count} message${count !== 1 ? 's' : ''}`;
}

const SessionSelector: React.FC<SessionSelectorProps> = ({
	onSelect,
	onCancel,
}) => {
	const [sessions, setSessions] = useState<SessionMetadata[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const loadSessions = async () => {
			try {
				const sessionList = await sessionManager.listSessions();
				// Sort by lastAccessedAt descending (most recent first)
				const sortedSessions = sessionList.sort(
					(a, b) =>
						new Date(b.lastAccessedAt).getTime() -
						new Date(a.lastAccessedAt).getTime(),
				);
				setSessions(sortedSessions);
			} catch (error) {
				console.error('Failed to load sessions:', error);
			} finally {
				setLoading(false);
			}
		};

		loadSessions();
	}, []);

	useInput((_input, key) => {
		if (key.escape) {
			if (!loading) {
				onCancel();
			}
			return;
		}
		if (!loading && sessions.length === 0) {
			onCancel();
		}
	});

	if (loading) {
		return (
			<Box flexDirection="column" marginY={1}>
				<Text>Loading sessions...</Text>
			</Box>
		);
	}

	if (sessions.length === 0) {
		return (
			<Box flexDirection="column" marginY={1}>
				<Text>No saved sessions found.</Text>
				<Text dimColor>Press any key to continue...</Text>
			</Box>
		);
	}

	const items = sessions.map((session, index) => ({
		label: `[${index + 1}] ${session.title} (${formatMessageCount(session.messageCount)}) - ${formatTimeAgo(session.lastAccessedAt)}`,
		value: session.id,
	}));

	const handleSelect = (item: {value: string}) => {
		const selectedSession = sessions.find(s => s.id === item.value);
		if (selectedSession) {
			onSelect(selectedSession);
		} else {
			onCancel();
		}
	};

	return (
		<Box flexDirection="column" marginY={1}>
			<Text bold>Recent Sessions:</Text>
			<Box marginTop={1}>
				<SelectInput
					items={items}
					onSelect={handleSelect}
					limit={Math.min(items.length, 10)}
				/>
			</Box>
			<Box marginTop={1}>
				<Text dimColor>↑/↓ to navigate • Enter to select • Esc to cancel</Text>
			</Box>
		</Box>
	);
};

export default SessionSelector;
