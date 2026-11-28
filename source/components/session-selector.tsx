import {Box, Text, useInput} from 'ink';
import React, {useCallback, useEffect, useState} from 'react';
import {FilterableSelectList} from '@/components/filterable-select-list';
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
	/** Missing where session storage is unavailable; the actions are hidden then. */
	onDeleteSession?: (sessionId: string) => void | Promise<void>;
	onPinSession?: (sessionId: string, pinned: boolean) => void | Promise<void>;
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
	onDeleteSession,
	onPinSession,
}) => {
	const [sessions, setSessions] = useState<SessionMetadata[]>([]);
	const [loading, setLoading] = useState(true);
	const [hasOtherSessions, setHasOtherSessions] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<SessionMetadata | null>(
		null,
	);
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const {actualWidth, truncate} = useResponsiveTerminal();

	const loadSessions = useCallback(async () => {
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
	}, [showAll]);

	useEffect(() => {
		void loadSessions();
	}, [loadSessions]);

	// Escape is ignored while loading, and once sessions are listed
	// FilterableSelectList owns it (Ink useInput is broadcast, so a second
	// active handler would fire onCancel twice). Only the empty state needs this.
	useInput(
		(_input, key) => {
			if (key.escape) {
				onCancel();
			}
		},
		{isActive: !loading && sessions.length === 0},
	);

	const confirmDelete = useCallback(async () => {
		const session = pendingDelete;
		if (!session) return;
		setPendingDelete(null);
		try {
			await onDeleteSession?.(session.id);
			setSessions(prev => prev.filter(s => s.id !== session.id));
		} catch (error) {
			console.error('Failed to delete session:', error);
		}
	}, [pendingDelete, onDeleteSession]);

	const togglePin = useCallback(
		async (sessionId: string) => {
			const session = sessions.find(s => s.id === sessionId);
			if (!session) return;
			const pinned = !session.pinned;
			try {
				await onPinSession?.(sessionId, pinned);
				setSessions(prev =>
					prev.map(s => (s.id === sessionId ? {...s, pinned} : s)),
				);
			} catch (error) {
				console.error('Failed to update session pin:', error);
			}
		},
		[sessions, onPinSession],
	);

	// The confirmation replaces the list, so FilterableSelectList is unmounted
	// and these keys cannot leak into the filter query.
	useInput(
		(input, key) => {
			if (key.escape) {
				setPendingDelete(null);
				return;
			}
			const char = input.toLowerCase();
			if (char === 'y') {
				void confirmDelete();
			} else if (char === 'n') {
				setPendingDelete(null);
			}
		},
		{isActive: pendingDelete !== null},
	);

	if (pendingDelete) {
		return (
			<TitledBoxWithPreferences
				title="Delete Session"
				width={boxWidth}
				borderColor={colors.warning}
				paddingX={2}
				paddingY={1}
				marginBottom={1}
			>
				<Box flexDirection="column">
					<Text>Delete "{pendingDelete.title}"?</Text>
					<Text color={colors.secondary}>
						Its conversation and artifacts will be removed permanently.
					</Text>
					<Box marginTop={1}>
						<Text color={colors.secondary}>y delete • n/Esc cancel</Text>
					</Box>
				</Box>
			</TitledBoxWithPreferences>
		);
	}

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
						<Text color={colors.secondary}>Press Esc to close</Text>
					</Box>
				</Box>
			</TitledBoxWithPreferences>
		);
	}

	const items = sessions.map((session, index) => {
		const prefix = `[${index + 1}] `;
		const pinMark = session.pinned ? '[pinned] ' : '';
		const suffix = ` (${formatMessageCount(session.messageCount)}) - ${formatTimeAgo(session.lastAccessedAt)}`;
		// 4 accounts for the `> ` selector indicator + margin
		const maxTitleLength =
			actualWidth - prefix.length - pinMark.length - suffix.length - 8;
		const truncatedTitle =
			maxTitleLength > 10
				? truncate(session.title, maxTitleLength)
				: session.title;

		return {
			label: `${prefix}${pinMark}${truncatedTitle}${suffix}`,
			value: session.id,
			// Filter on the title alone: the count/age suffix would match most queries.
			searchText: session.title,
		};
	});

	const handleSelect = (value: string) => {
		const selectedSession = sessions.find(s => s.id === value);
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
				<FilterableSelectList
					items={items}
					onSelect={handleSelect}
					onCancel={onCancel}
					visibleCount={10}
					onDelete={
						onDeleteSession
							? id => {
									const session = sessions.find(s => s.id === id);
									if (session) setPendingDelete(session);
								}
							: undefined
					}
					onPin={onPinSession ? id => void togglePin(id) : undefined}
				/>
				<Box marginTop={1}>
					<Text color={colors.secondary}>
						{onDeleteSession || onPinSession
							? 'Type to filter • ↑/↓ to navigate • Enter select • Ctrl+D delete • Ctrl+P pin • Esc cancel'
							: 'Type to filter • ↑/↓ to navigate • Enter to select • Esc to cancel'}
					</Text>
				</Box>
			</Box>
		</TitledBoxWithPreferences>
	);
};

export default SessionSelector;
