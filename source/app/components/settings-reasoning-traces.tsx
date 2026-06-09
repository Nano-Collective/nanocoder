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
import type {ChangeDiff} from './settings-keep-discard-prompt';

interface SettingsReasoningTracesPanelProps {
	onBack: () => void;
	onCancel: () => void;
	onChanged?: (diff: ChangeDiff) => void;
}

export function SettingsReasoningTracesPanel({
	onBack,
	onCancel,
	onChanged,
}: SettingsReasoningTracesPanelProps) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const saved = getReasoningExpanded();
	const [enabled, setEnabled] = useState(saved ?? false);

	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
	});

	const items = useMemo(
		() => [
			{
				label: `Reasoning Traces: ${enabled ? 'Expanded' : 'Collapsed'}`,
				value: 'toggle' as const,
				description: enabled
					? 'Full reasoning traces are displayed by default'
					: 'Reasoning traces are collapsed by default (Ctrl+R to toggle)',
			},
		],
		[enabled],
	);

	const handleSelect = () => {
		const next = !enabled;
		onChanged?.({
			setting: 'Reasoning Traces',
			oldValue: enabled ? 'Expanded' : 'Collapsed',
			newValue: next ? 'Expanded' : 'Collapsed',
		});
		setEnabled(next);
		updateReasoningExpanded(next);
	};

	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title="Settings · Reasoning Traces"
				width="100%"
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<SelectInput
					items={items}
					onSelect={handleSelect}
					indicatorComponent={({isSelected}) => (
						<Text color={isSelected ? colors.primary : colors.text}>
							{isSelected ? '> ' : '  '}
						</Text>
					)}
					itemComponent={({isSelected, label}) => (
						<Text color={isSelected ? colors.primary : colors.text}>
							{label}
						</Text>
					)}
				/>
				<Box marginTop={0}>
					<Text color={colors.secondary}>Enter/Shift+Tab/Esc</Text>
				</Box>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Settings · Reasoning Traces"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					Press Enter to toggle. Shift+Tab to go back, Esc to exit
				</Text>
			</Box>
			<SelectInput
				items={items.map(item => ({
					label: item.label,
					value: item.value,
					description: item.description,
				}))}
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
