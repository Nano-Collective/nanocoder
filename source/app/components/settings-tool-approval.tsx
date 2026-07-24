import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useMemo} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {getAppConfig} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

/**
 * Read-only view of the tools that run without confirmation (agents.config.json
 * alwaysAllow + nanocoderTools.alwaysAllow). Editing is done in the config file.
 */
export function SettingsToolApprovalPanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const tools = getAppConfig().alwaysAllow ?? [];

	useInput((_, key) => {
		if (key.escape) onCancel();
		if (key.shift && key.tab) onBack();
	});

	const items = useMemo(() => {
		const rows = [
			{label: `Auto-approved tools (${tools.length})`, value: 'info'},
		];
		if (tools.length === 0) {
			rows.push({label: '  (none configured)', value: 'empty'});
		} else {
			for (const tool of tools) rows.push({label: `  ${tool}`, value: tool});
		}
		return rows;
	}, [tools]);

	return (
		<TitledBoxWithPreferences
			title="Settings · Tool Auto-Approval"
			width={isNarrow ? '100%' : boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					These tools run without confirmation. Edit agents.config.json to
					change.
				</Text>
			</Box>
			<SelectInput
				items={items}
				onSelect={() => {}}
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
				<Text color={colors.secondary}>Shift+Tab back · Esc exit</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
