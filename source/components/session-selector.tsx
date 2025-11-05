import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { TitledBox, titleStyles } from '@mishieck/ink-titled-box';
import { useTheme } from '@/hooks/useTheme';
import { useTerminalWidth } from '@/hooks/useTerminalWidth';
import { SessionManager, Session } from '@/session/session-manager';
import { formatDistanceToNow } from './utils/date-utils';

interface SessionSelectorProps {
	sessionManager: SessionManager;
	onSessionSelect: (sessionId: string | null) => void;
	onCancel: () => void;
}

interface SessionOption {
	label: string;
	value: string;
}

export default function SessionSelector({
	sessionManager,
	onSessionSelect,
	onCancel,
}: SessionSelectorProps) {
	const boxWidth = useTerminalWidth();
	const { colors } = useTheme();
	const [sessions, setSessions] = useState<Session[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [sortBy, setSortBy] = useState<'date' | 'messages'>('date');
	const [currentPage, setCurrentPage] = useState(0);
	const [filteredSessions, setFilteredSessions] = useState<Session[]>([]);
	const itemsPerPage = 10;

	// Handle keyboard input
	useInput((input, key) => {
		if (key.escape) {
			onCancel();
		}
		
		// Handle number input to select sessions directly
		if (input && /^\d$/.test(input)) {
			const sessionNumber = parseInt(input, 10);
			// Check if the number corresponds to a session on the current page
			if (sessionNumber >= 1 && sessionNumber <= currentSessions.length) {
				const sessionIndex = startIndex + sessionNumber - 1;
				if (sessionIndex < filteredSessions.length) {
					onSessionSelect(filteredSessions[sessionIndex].id);
					return;
				}
			}
		}
		
		// Handle 'q' to cancel
		if (input && input.toLowerCase() === 'q') {
			onCancel();
			return;
		}
		
		// Handle search input
		if (input && /^[a-zA-Z0-9\s]$/.test(input)) {
			setSearchQuery(prev => prev + input);
		}
		
		// Handle backspace for search
		if (key.backspace) {
			setSearchQuery(prev => prev.slice(0, -1));
		}
		
		// Handle return to clear search
		if (key.return) {
			// Enter key pressed, could be used for search submission if needed
		}
		
		// Handle arrow keys for sorting
	if (key.leftArrow || key.rightArrow) {
			setSortBy(prev => prev === 'date' ? 'messages' : 'date');
		}
	});

	useEffect(() => {
	  const loadSessions = async () => {
	    try {
	      // Use listSessions with size info for optimization
	      const sessionList = await sessionManager.listSessions(true);
	      
	      // Load detailed session data using caching
	      const detailedSessions: Session[] = [];
	      for (const sessionInfo of sessionList) {
	        const session = await sessionManager.getSessionWithCache(sessionInfo.id, true);
	        if (session) {
	          detailedSessions.push(session);
	        }
	      }

	      // Sort sessions by date (newest first) by default
	      detailedSessions.sort((a, b) => b.updatedAt - a.updatedAt);
	      setSessions(detailedSessions);
	      setLoading(false);
	    } catch (err) {
	      setError(`Error loading sessions: ${String(err)}`);
	      setLoading(false);
	    }
	  };

	  void loadSessions();
	}, [sessionManager]);

	// Apply search and filter
	useEffect(() => {
		let result = [...sessions];

		// Apply search filter
		if (searchQuery) {
			const query = searchQuery.toLowerCase();
			result = result.filter(session =>
				session.title.toLowerCase().includes(query) ||
				session.messages.some(message =>
					message.content.toLowerCase().includes(query)
				)
			);
		}

		// Apply sorting
		if (sortBy === 'date') {
			result.sort((a, b) => b.updatedAt - a.updatedAt);
		} else if (sortBy === 'messages') {
			result.sort((a, b) => b.messages.length - a.messages.length);
		}

		setFilteredSessions(result);
		setCurrentPage(0); // Reset to first page when filtering/sorting changes
	}, [sessions, searchQuery, sortBy]);

	// Calculate pagination
	const totalPages = Math.ceil(filteredSessions.length / itemsPerPage);
	const startIndex = currentPage * itemsPerPage;
	const endIndex = Math.min(startIndex + itemsPerPage, filteredSessions.length);
	const currentSessions = filteredSessions.slice(startIndex, endIndex);

	// Convert sessions to options for the select input
	const sessionOptions: SessionOption[] = currentSessions.map((session, index) => {
		const sessionDate = new Date(session.updatedAt);
		const timeAgo = formatDistanceToNow(sessionDate);
		const messageCount = session.messages.length;
		
		// Extract provider/model info from session metadata if available
	const providerInfo = session.metadata?.provider ? ` - ${session.metadata.provider}` : '';
		const modelInfo = session.metadata?.model ? `/${session.metadata.model}` : '';
		
		return {
			label: `[${startIndex + index + 1}] ${session.title || 'Untitled Session'} (${messageCount} message${messageCount !== 1 ? 's' : ''})${providerInfo}${modelInfo} - ${timeAgo}`,
			value: session.id,
	};
	});

	// Add pagination controls as options
	if (totalPages > 1) {
		if (currentPage > 0) {
			sessionOptions.unshift({
				label: '← Previous Page',
				value: 'prev',
			});
		}
		if (currentPage < totalPages - 1) {
			sessionOptions.push({
				label: '→ Next Page',
				value: 'next',
			});
		}
	}

	const handleSelect = (item: { label: string; value: string }) => {
		if (item.value === 'prev') {
			setCurrentPage(prev => Math.max(0, prev - 1));
			return;
		}
		if (item.value === 'next') {
			setCurrentPage(prev => Math.min(totalPages - 1, prev + 1));
			return;
		}
		
		onSessionSelect(item.value);
	};

	// Create a simple input for search
	const handleSearchInput = (input: string) => {
		if (input.toLowerCase() === 'q') {
			onCancel();
			return;
		}
		
		// Check if input is a number to select a session
		const sessionNumber = parseInt(input, 10);
		if (!isNaN(sessionNumber) && sessionNumber >= 1 && sessionNumber <= filteredSessions.length) {
			const sessionIndex = sessionNumber - 1;
			onSessionSelect(filteredSessions[sessionIndex].id);
			return;
		}
		
		// Additional check for number input that might be for current page
		if (!isNaN(sessionNumber) && sessionNumber >= 1 && sessionNumber <= currentSessions.length) {
			const sessionIndex = startIndex + sessionNumber - 1;
			if (sessionIndex < filteredSessions.length) {
				onSessionSelect(filteredSessions[sessionIndex].id);
				return;
			}
		}
		
		// Otherwise treat as search query
		setSearchQuery(input);
	};

	if (loading) {
		return (
			<TitledBox
				key={colors.primary}
				borderStyle="round"
				titles={['Session Selection']}
				titleStyles={titleStyles.pill}
				width={boxWidth}
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				marginBottom={1}
			>
				<Text color={colors.secondary}>Loading sessions...</Text>
			</TitledBox>
		);
	}

	if (error) {
		return (
			<TitledBox
				borderStyle="round"
				titles={['Session Selection - Error']}
				titleStyles={titleStyles.pill}
				width={boxWidth}
				borderColor={colors.error}
				paddingX={2}
				paddingY={1}
				marginBottom={1}
			>
				<Box flexDirection="column">
					<Text color={colors.error}>{error}</Text>
					<Box marginTop={1}>
						<Text color={colors.secondary}>Press Escape to cancel</Text>
					</Box>
				</Box>
			</TitledBox>
		);
	}

	return (
		<TitledBox
			borderStyle="round"
			titles={['Session Selection']}
			titleStyles={titleStyles.pill}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			marginBottom={1}
		>
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text color={colors.secondary}>Search: </Text>
					<Text color={colors.primary}>{searchQuery || '[Type to search]'}</Text>
					{searchQuery && (
						<Text color={colors.secondary}> (Press Backspace to clear)</Text>
					)}
				</Box>
				
				<Box marginBottom={1}>
					<Text color={colors.secondary}>Sort by: </Text>
					<Text
						color={sortBy === 'date' ? colors.primary : colors.secondary}
						bold={sortBy === 'date'}
					>
						Date (Press ←→)
					</Text>
					<Text color={colors.secondary}> | </Text>
					<Text
						color={sortBy === 'messages' ? colors.primary : colors.secondary}
						bold={sortBy === 'messages'}
					>
						Messages (Press ←→)
					</Text>
				</Box>
				
				{sessionOptions.length > 0 ? (
					<SelectInput items={sessionOptions} onSelect={handleSelect} />
				) : (
					<Text color={colors.secondary}>No sessions found</Text>
				)}
				
				{totalPages > 1 && (
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Page {currentPage + 1} of {totalPages}
						</Text>
					</Box>
				)}
				
				<Box marginTop={1}>
					<Text color={colors.secondary}>Enter number to resume, or 'q' to cancel</Text>
				</Box>
			</Box>
		</TitledBox>
	);
}