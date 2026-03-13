import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {getThemeColors} from '@/config/themes';
import {useTheme} from '@/hooks/useTheme';

interface IdeSelectorProps {
	onSelect: (ide: string) => void;
	onCancel: () => void;
}

const items = [{label: 'VS Code', value: 'vscode'}];

export function IdeSelector({onSelect, onCancel}: IdeSelectorProps) {
	const {currentTheme} = useTheme();
	const colors = getThemeColors(currentTheme);

	useInput((_input, key) => {
		if (key.escape) {
			onCancel();
		}
	});

	return (
		<Box flexDirection="column" paddingY={1}>
			<Text color={colors.primary} bold>
				Connect to an IDE
			</Text>
			<Box marginTop={1}>
				<Text color={colors.secondary}>
					Select an IDE to enable live integration:
				</Text>
			</Box>
			<Box marginTop={1}>
				<SelectInput items={items} onSelect={item => onSelect(item.value)} />
			</Box>
			<Box marginTop={1}>
				<Text color={colors.secondary} dimColor>
					Press Escape to cancel
				</Text>
			</Box>
		</Box>
	);
}
