import {commandRegistry} from '@/commands';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useMemo} from 'react';

interface SettingsSelectorProps {
	onSelect: (commandName: string) => void;
	onCancel: () => void;
}

export function SettingsSelector({onSelect, onCancel}: SettingsSelectorProps) {
	const {colors} = useTheme();
	const width = useTerminalWidth();

	const items = useMemo(() => {
		const commands = commandRegistry.getAll();
		const uiCommands = ['theme', 'title-shape', 'nanocoder-shape'];
		
		return commands
			.filter(cmd => uiCommands.includes(cmd.name))
			.map(cmd => ({
				label: `/${cmd.name} - ${cmd.description}`,
				value: cmd.name,
			}))
			.sort((a, b) => a.label.localeCompare(b.label));
	}, []);

	// Handle Escape key
	useInput((_input, key) => {
		if (key.escape) {
			onCancel();
		}
	});

	return (
		<TitledBoxWithPreferences
			title="Settings"
			width={width}
			borderColor={colors.primary}
			paddingX={1}
			paddingY={1}
			flexDirection="column"
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>Select a UI setting to configure:</Text>
			</Box>
			<SelectInput
				items={items}
				onSelect={item => onSelect(item.value)}
				indicatorComponent={({isSelected}) => (
					<Text color={isSelected ? colors.primary : colors.text}>
						{isSelected ? '> ' : '  '}
					</Text>
				)}
				itemComponent={({isSelected, label}) => (
					<Text color={isSelected ? colors.primary : colors.text}>{label}</Text>
				)}
			/>
			<Box marginTop={1}>
				<Text color={colors.secondary} dimColor>
					Press Enter to select, Esc to cancel
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
