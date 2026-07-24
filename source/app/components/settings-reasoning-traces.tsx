import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useMemo, useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {
	getReasoningExpanded,
	updateReasoningExpanded,
} from '@/config/preferences';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

/**
 * Toggle whether reasoning traces are expanded by default. Persists to
 * nanocoder-preferences.json (reasoningExpanded).
 */
export function SettingsReasoningTracesPanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const [enabled, setEnabled] = useState(getReasoningExpanded() ?? false);

	useInput((_, key) => {
		if (key.escape) onCancel();
		if (key.shift && key.tab) onBack();
	});

	const items = useMemo(
		() => [
			{
				label: `Reasoning Traces: ${enabled ? 'Expanded' : 'Collapsed'}`,
				value: 'toggle',
				description: enabled
					? 'Full reasoning traces are displayed by default'
					: 'Reasoning traces are collapsed by default (Ctrl+R to toggle)',
			},
		],
		[enabled],
	);

	const handleSelect = () => {
		const next = !enabled;
		updateReasoningExpanded(next);
		setEnabled(next);
	};

	return (
		<TitledBoxWithPreferences
			title="Settings · Reasoning Traces"
			width={isNarrow ? '100%' : boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					Press Enter to toggle · Shift+Tab back · Esc exit
				</Text>
			</Box>
			<SelectInput
				items={items}
				onSelect={handleSelect}
				indicatorComponent={({isSelected}) => (
					<Text color={isSelected ? colors.primary : colors.text}>
						{isSelected ? '> ' : '  '}
					</Text>
				)}
				itemComponent={({isSelected, label}) => (
					<Text color={isSelected ? colors.primary : colors.text}>{label}</Text>
				)}
			/>
		</TitledBoxWithPreferences>
	);
}
