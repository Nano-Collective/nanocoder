import {Box, Text, useInput} from 'ink';
import React, {useEffect, useState} from 'react';
import {StyledSelectInput} from '@/components/ui/styled-select-input';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {
	useResponsiveTerminal,
	useTerminalWidth,
} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {SessionMetadata} from '@/session/session-manager';
import {sessionManager} from '@/session/session-manager';

interface SessionSelectorProps {
	onSelect: (session: SessionMetadata | null) => void;
	onCancel: () => void;
	showAll?: boolean;
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
	showAll,
}) => {
	const [sessions, setSessions] = useState<SessionMetadata[]>([]);
	const [loading, setLoading] = useState(true);
	const [hasOtherSessions, setHasOtherSessions] = useState(false);
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const {actualWidth, truncate} = useResponsiveTerminal();

	useEffect(() => {
		const loadSessions = async () => {
			try {
				const filter = showAll ? undefined : {workingDirectory: process.cwd()};
				const sessionList = await sessionManager.listSessions(filter);
				// Sort by lastAccessedAt descending (most recent first)
				const sortedSessions = sessionList.sort(
					(a, b) =>
						new Date(b.lastAccessedAt).getTime() -
						new Date(a.lastAccessedAt).getTime(),
				);
				setSessions(sortedSessions);

				// Check if there are sessions in other projects
				if (!showAll && sortedSessions.length === 0) {
					const allSessions = await sessionManager.listSessions();
					setHasOtherSessions(allSessions.length > 0);
				}
			} catch (error) {
				console.error('Failed to load sessions:', error);
			} finally {
				setLoading(false);
			}
		};

		loadSessions();
	}, [showAll]);

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
			<TitledBoxWithPreferences
				title="Recent Sessions"
				width={boxWidth}
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				marginBottom={1}
			>
				<Text color={colors.secondary}>Loading sessions...</Text>
			</TitledBoxWithPreferences>
		);
	}

	if (sessions.length === 0) {
		return (
			<TitledBoxWithPreferences
				title="Recent Sessions"
				width={boxWidth}
				borderColor={colors.secondary}
				paddingX={2}
				paddingY={1}
				marginBottom={1}
			>
				<Box flexDirection="column">
					{hasOtherSessions ? (
						<>
							<Text>No sessions for this project.</Text>
							<Text color={colors.secondary}>
								Use /resume --all to see all sessions.
							</Text>
						</>
					) : (
						<Text>No saved sessions found.</Text>
					)}
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Press any key to continue • Esc to cancel
						</Text>
					</Box>
				</Box>
			</TitledBoxWithPreferences>
		);
	}

	const items = sessions.map((session, index) => {
		const prefix = `[${index + 1}] `;
		const suffix = ` (${formatMessageCount(session.messageCount)}) - ${formatTimeAgo(session.lastAccessedAt)}`;
		// 4 accounts for the `> ` selector indicator + margin
		const maxTitleLength = actualWidth - prefix.length - suffix.length - 8;
		const truncatedTitle =
			maxTitleLength > 10
				? truncate(session.title, maxTitleLength)
				: session.title;

		return {
			label: `${prefix}${truncatedTitle}${suffix}`,
			value: session.id,
		};
	});

	const handleSelect = (item: {value: string}) => {
		const selectedSession = sessions.find(s => s.id === item.value);
		if (selectedSession) {
			onSelect(selectedSession);
		} else {
			onCancel();
		}
	};

	return (
		<TitledBoxWithPreferences
			title="Recent Sessions"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			marginBottom={1}
		>
			<Box flexDirection="column">
				<StyledSelectInput
					items={items}
					onSelect={handleSelect}
					limit={Math.min(items.length, 10)}
				/>
				<Box marginTop={1}>
					<Text color={colors.secondary}>
						↑/↓ to navigate • Enter to select • Esc to cancel
					</Text>
				</Box>
			</Box>
		</TitledBoxWithPreferences>
	);
};

export default SessionSelector;
