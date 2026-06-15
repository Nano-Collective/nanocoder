import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useMemo, useState} from 'react';
import TextInput from '@/components/text-input';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {updateConfigNestedValue} from '@/config/config-writer';
import {getAppConfig} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {AutoCompactConfig, CompressionMode} from '@/types/config';
import type {ChangeDiff} from './settings-keep-discard-prompt';

interface SettingsAutoCompactPanelProps {
	onBack: () => void;
	onCancel: () => void;
	onChanged?: (diff: ChangeDiff) => void;
}

const MODE_OPTIONS: {label: string; value: CompressionMode}[] = [
	{label: 'Default', value: 'default'},
	{label: 'Conservative', value: 'conservative'},
	{label: 'Aggressive', value: 'aggressive'},
];

const DEFAULT_CONFIG: AutoCompactConfig = {
	enabled: true,
	threshold: 60,
	mode: 'conservative',
	strategy: 'mechanical',
	notifyUser: true,
};

export function SettingsAutoCompactPanel({
	onBack,
	onCancel,
	onChanged,
}: SettingsAutoCompactPanelProps) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const currentConfig = getAppConfig().autoCompact ?? DEFAULT_CONFIG;
	const [config, setConfig] = useState<AutoCompactConfig>(currentConfig);
	const [editField, setEditField] = useState<string | null>(null);
	const [editValue, setEditValue] = useState('');
	const [error, setError] = useState<string | null>(null);

	useInput((_, key) => {
		if (key.escape) {
			if (editField) {
				setEditField(null);
				setError(null);
			} else {
				onCancel();
			}
		}
		if (key.shift && key.tab && !editField) {
			onBack();
		}
	});

	const items = useMemo(() => {
		return [
			{
				label: `Enabled: ${config.enabled ? 'ON' : 'OFF'}`,
				value: 'enabled' as const,
			},
			{
				label: `Threshold: ${config.threshold}%`,
				value: 'threshold' as const,
			},
			{
				label: `Mode: ${config.mode}`,
				value: 'mode' as const,
			},
			{
				label: `Notify: ${config.notifyUser ? 'ON' : 'OFF'}`,
				value: 'notifyUser' as const,
			},
		];
	}, [config]);

	const handleSelect = (item: {value: string}) => {
		setError(null);
		if (item.value === 'threshold') {
			setEditField('threshold');
			setEditValue(String(config.threshold));
		} else if (item.value === 'mode') {
			// Cycle through modes
			const currentIdx = MODE_OPTIONS.findIndex(m => m.value === config.mode);
			const nextMode =
				MODE_OPTIONS[(currentIdx + 1) % MODE_OPTIONS.length].value;
			const next = {...config, mode: nextMode};
			setConfig(next);
			onChanged?.({
				setting: 'Auto-Compact Mode',
				oldValue: config.mode,
				newValue: nextMode,
				persist: () => updateConfigNestedValue('autoCompact', 'mode', nextMode),
			});
		} else if (item.value === 'enabled' || item.value === 'notifyUser') {
			const key = item.value as 'enabled' | 'notifyUser';
			const next = {...config, [key]: !config[key]};
			setConfig(next);
			onChanged?.({
				setting: key === 'enabled' ? 'Auto-Compact' : 'Auto-Compact Notify',
				oldValue: String(config[key]),
				newValue: String(next[key]),
				persist: () => updateConfigNestedValue('autoCompact', key, next[key]),
			});
		}
	};

	const handleThresholdSubmit = (value: string) => {
		const num = parseInt(value.trim(), 10);
		if (isNaN(num)) {
			setError('Must be a number');
			return;
		}
		if (num < 50 || num > 95) {
			setError('Must be between 50 and 95');
			return;
		}
		setError(null);
		const next = {...config, threshold: num};
		setConfig(next);
		onChanged?.({
			setting: 'Auto-Compact Threshold',
			oldValue: String(config.threshold),
			newValue: String(num),
			persist: () => updateConfigNestedValue('autoCompact', 'threshold', num),
		});
		setEditField(null);
	};

	const title = isNarrow ? 'Auto-Compact' : 'Settings · Auto-Compact';

	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title={title}
				width="100%"
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				{editField === 'threshold' ? (
					<Box flexDirection="column">
						<Text color={colors.secondary}>Enter threshold (50-95):</Text>
						<Box
							marginBottom={1}
							borderStyle="round"
							borderColor={colors.secondary}
						>
							<TextInput
								value={editValue}
								onChange={setEditValue}
								onSubmit={handleThresholdSubmit}
							/>
						</Box>
						{error && <Text color={colors.error}>⚠ {error}</Text>}
						<Text color={colors.secondary}>Enter to save · Esc to cancel</Text>
					</Box>
				) : (
					<Box flexDirection="column">
						<SelectInput items={items} onSelect={handleSelect} />
						<Box marginBottom={1}></Box>
						<Text color={colors.secondary}>Enter/Shift+Tab/Esc</Text>
					</Box>
				)}
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title={title}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{editField === 'threshold' ? (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={colors.secondary}>
							Enter threshold percentage (50–95). Current: {config.threshold}%
						</Text>
					</Box>
					<Box
						marginBottom={1}
						borderStyle="round"
						borderColor={colors.secondary}
					>
						<TextInput
							value={editValue}
							onChange={setEditValue}
							onSubmit={handleThresholdSubmit}
						/>
					</Box>
					{error && (
						<Box marginBottom={1}>
							<Text color={colors.error}>⚠ {error}</Text>
						</Box>
					)}
					<Text color={colors.secondary}>Enter to save · Esc to cancel</Text>
				</Box>
			) : (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={colors.secondary}>
							Toggle with Enter. Threshold opens text input. Shift+Tab back, Esc
							exit.
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
							<Text color={isSelected ? colors.primary : colors.text}>
								{label}
							</Text>
						)}
					/>
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Enter to toggle, Shift+Tab to go back, Esc to exit
						</Text>
					</Box>
				</Box>
			)}
		</TitledBoxWithPreferences>
	);
}
