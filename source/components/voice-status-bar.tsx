import {Box, Text} from 'ink';
import {memo} from 'react';

import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getThemeColors} from '@/config/themes';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import type {ThemePreset} from '@/types/ui';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

export const VoiceStatusBar = memo(function VoiceStatusBar({
	state,
	theme,
}: {
	state: VoiceState;
	theme: ThemePreset;
}) {
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const colors = getThemeColors(theme);

	const getStateColor = () => {
		switch (state) {
			case 'listening':
				return colors.info; // Info for listening
			case 'processing':
				return colors.warning; // Yellow for thinking
			case 'speaking':
				return colors.success; // Green for speaking
			case 'idle':
			default:
				return colors.secondary; // Dimmed for idle
		}
	};

	const getStateLabel = () => {
		switch (state) {
			case 'listening':
				return '● Listening...';
			case 'processing':
				return '○ Processing...';
			case 'speaking':
				return '♪ Speaking...';
			case 'idle':
			default:
				return '○ Idle (Hold Ctrl+T to talk)';
		}
	};

	const color = getStateColor();

	return (
		<>
			{isNarrow ? (
				<Box
					flexDirection="column"
					marginBottom={1}
					borderStyle="round"
					borderColor={color}
					paddingY={1}
					paddingX={2}
				>
					<Text color={color}>
						<Text bold={true}>Voice: </Text>
						{getStateLabel()}
					</Text>
				</Box>
			) : (
				<TitledBoxWithPreferences
					title="Voice Status"
					width={boxWidth}
					borderColor={color}
					paddingX={2}
					paddingY={1}
					flexDirection="column"
					marginBottom={1}
				>
					<Text color={color}>
						<Text bold={true}>State: </Text>
						{getStateLabel()}
					</Text>
				</TitledBoxWithPreferences>
			)}
		</>
	);
});
