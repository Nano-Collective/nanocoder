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

const MODE_OPTIONS: CompressionMode[] = [
	'default',
	'conservative',
	'aggressive',
];

const DEFAULT_CONFIG: AutoCompactConfig = {
	enabled: true,
	threshold: 60,
	mode: 'conservative',
	strategy: 'mechanical',
	notifyUser: true,
};

/**
 * Auto-compact settings (agents.config.json nanocoder.autoCompact). Each change
 * persists atomically and directly — no keep/discard prompt.
 */
export function SettingsAutoCompactPanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const [config, setConfig] = useState<AutoCompactConfig>(
		getAppConfig().autoCompact ?? DEFAULT_CONFIG,
	);
	const [editing, setEditing] = useState(false);
	const [editValue, setEditValue] = useState('');
	const [error, setError] = useState<string | null>(null);

	useInput((_, key) => {
		if (key.escape) {
			if (editing) {
				setEditing(false);
				setError(null);
			} else {
				onCancel();
			}
		}
		if (key.shift && key.tab && !editing) onBack();
	});

	const items = useMemo(
		() => [
			{label: `Enabled: ${config.enabled ? 'ON' : 'OFF'}`, value: 'enabled'},
			{label: `Threshold: ${config.threshold}%`, value: 'threshold'},
			{label: `Mode: ${config.mode}`, value: 'mode'},
			{
				label: `Notify: ${config.notifyUser ? 'ON' : 'OFF'}`,
				value: 'notifyUser',
			},
		],
		[config],
	);

	const persist = <K extends keyof AutoCompactConfig>(
		key: K,
		value: AutoCompactConfig[K],
	) => {
		setConfig(prev => ({...prev, [key]: value}));
		updateConfigNestedValue('autoCompact', key, value);
	};

	const handleSelect = (item: {value: string}) => {
		setError(null);
		if (item.value === 'threshold') {
			setEditValue(String(config.threshold));
			setEditing(true);
		} else if (item.value === 'mode') {
			const idx = MODE_OPTIONS.indexOf(config.mode);
			persist('mode', MODE_OPTIONS[(idx + 1) % MODE_OPTIONS.length]);
		} else if (item.value === 'enabled') {
			persist('enabled', !config.enabled);
		} else if (item.value === 'notifyUser') {
			persist('notifyUser', !config.notifyUser);
		}
	};

	const submitThreshold = (value: string) => {
		const num = Number.parseInt(value.trim(), 10);
		if (Number.isNaN(num)) return setError('Must be a number');
		if (num < 50 || num > 95) return setError('Must be between 50 and 95');
		persist('threshold', num);
		setEditing(false);
	};

	return (
		<TitledBoxWithPreferences
			title="Settings · Auto-Compact"
			width={isNarrow ? '100%' : boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{editing ? (
				<Box flexDirection="column">
					<Text color={colors.secondary}>
						Threshold % (50–95). Current: {config.threshold}%
					</Text>
					<Box marginY={1} borderStyle="round" borderColor={colors.secondary}>
						<TextInput
							value={editValue}
							onChange={setEditValue}
							onSubmit={submitThreshold}
						/>
					</Box>
					{error && <Text color={colors.error}>⚠ {error}</Text>}
					<Text color={colors.secondary}>Enter to save · Esc to cancel</Text>
				</Box>
			) : (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={colors.secondary}>
							Enter toggles/cycles a setting · Shift+Tab back · Esc exit
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
				</Box>
			)}
		</TitledBoxWithPreferences>
	);
}
