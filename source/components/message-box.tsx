import {Box, Text} from 'ink';
import {memo} from 'react';

import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

type MessageType = 'error' | 'success' | 'warning' | 'info';

interface MessageBoxProps {
	type: MessageType;
	message: string;
	hideTitle?: boolean;
	hideBox?: boolean;
}

const defaultTitles: Record<MessageType, string> = {
	error: 'Error',
	success: 'Success',
	warning: 'Warning',
	info: 'Info',
};

const MessageBox = memo(function MessageBox({
	type,
	message,
	hideTitle = false,
	hideBox = false,
}: MessageBoxProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	// Direct lookup - MessageType keys match Colors interface keys
	const color = colors[type];
	const title = defaultTitles[type];

	return (
		<>
			{hideBox ? (
				<Box width={boxWidth} flexDirection="column" marginBottom={1}>
					<Text color={color}>{message}</Text>
				</Box>
			) : hideTitle ? (
				<Box
					borderStyle="round"
					width={boxWidth}
					borderColor={color}
					paddingX={2}
					paddingY={0}
					flexDirection="column"
					marginBottom={1}
				>
					<Text color={color}>{message}</Text>
				</Box>
			) : (
				<TitledBoxWithPreferences
					title={title}
					width={boxWidth}
					borderColor={color}
					paddingX={2}
					paddingY={1}
					flexDirection="column"
					marginBottom={1}
				>
					<Text color={color}>{message}</Text>
				</TitledBoxWithPreferences>
			)}
		</>
	);
});

// Convenience exports for backward compatibility
type SpecificMessageProps = Omit<MessageBoxProps, 'type'>;

export function ErrorMessage(props: SpecificMessageProps) {
	return <MessageBox type="error" {...props} />;
}

export function SuccessMessage(props: SpecificMessageProps) {
	return <MessageBox type="success" {...props} />;
}

export function WarningMessage(props: SpecificMessageProps) {
	return <MessageBox type="warning" {...props} />;
}

export function InfoMessage(props: SpecificMessageProps) {
	return <MessageBox type="info" {...props} />;
}
