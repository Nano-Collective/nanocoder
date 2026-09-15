import {Box, Text, useInput} from 'ink';
import {StyledSelectInput} from '@/components/ui/styled-select-input';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getThemeColors} from '@/config/themes';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

interface IdeSelectorProps {
	onSelect: (ide: string) => void;
	onCancel: () => void;
}

const items = [{label: 'VS Code', value: 'vscode'}];

export function IdeSelector({onSelect, onCancel}: IdeSelectorProps) {
	const {currentTheme} = useTheme();
	const colors = getThemeColors(currentTheme);
	const boxWidth = useTerminalWidth();

	useInput((_input, key) => {
		if (key.escape) {
			onCancel();
		}
	});

	return (
		<TitledBoxWithPreferences
			title="Connect to an IDE"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			marginBottom={1}
		>
			<Box flexDirection="column">
				<Text color={colors.secondary}>
					Select an IDE to enable live integration:
				</Text>
				<Box marginTop={1}>
					<StyledSelectInput
						items={items}
						onSelect={item => onSelect(item.value)}
					/>
				</Box>
				<Box marginTop={1}>
					<Text color={colors.secondary}>Press Escape to cancel</Text>
				</Box>
			</Box>
		</TitledBoxWithPreferences>
	);
}
