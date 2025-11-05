import React from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '@/hooks/useTheme';
import {formatDistanceToNow} from './utils/date-utils';

interface SessionSavingIndicatorProps {
	status: 'idle' | 'saving' | 'saved' | 'error';
	sessionTitle?: string;
	saveTime?: Date;
	error?: string;
	showTimestamp?: boolean;
}

export default function SessionSavingIndicator({
	status,
	sessionTitle,
	saveTime,
	error,
	showTimestamp = true,
}: SessionSavingIndicatorProps) {
	const {colors} = useTheme();

	if (status === 'idle') {
		return null;
	}

	let displayText = '';
	let displayColor = colors.secondary;

	switch (status) {
	case 'saving':
			displayText = 'Saving session...';
			displayColor = colors.warning || colors.primary;
			break;
	case 'saved':
			if (sessionTitle && saveTime && showTimestamp) {
				const timeAgo = formatDistanceToNow(saveTime);
				displayText = `Session saved as "${sessionTitle}" - ${timeAgo}`;
			} else if (sessionTitle) {
				displayText = `Session saved as "${sessionTitle}"`;
			} else {
				displayText = 'Session saved';
			}
			displayColor = colors.success || colors.primary;
			break;
		case 'error':
			displayText = error ? `Save error: ${error}` : 'Save error';
			displayColor = colors.error;
			break;
		default:
			return null;
	}

	return (
		<Box flexDirection="row" justifyContent="flex-end" marginTop={0.5} marginBottom={0.5}>
			<Text color={displayColor} bold={status !== 'saving'}>
				{displayText}
			</Text>
		</Box>
	);
}