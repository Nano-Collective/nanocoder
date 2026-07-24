import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useMemo, useState} from 'react';
import TextInput from '@/components/text-input';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {updateConfigNestedValue} from '@/config/config-writer';
import {getAppConfig} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {AppConfig} from '@/types/config';

type Sessions = NonNullable<AppConfig['sessions']>;

const DEFAULTS: Sessions = {
	autoSave: true,
	saveInterval: 30000,
	maxSessions: 50,
	maxMessages: 1000,
	retentionDays: 30,
	directory: '',
};

// Numeric fields with their minimum accepted value.
const NUM_MIN: Record<string, number> = {
	saveInterval: 1000,
	maxSessions: 1,
	maxMessages: 1,
	retentionDays: 1,
};

/**
 * Session save/retention settings (agents.config.json nanocoder.sessions).
 * Each change persists atomically and directly — no keep/discard prompt.
 */
export function SettingsSessionsPanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const [config, setConfig] = useState<Sessions>(
		getAppConfig().sessions ?? DEFAULTS,
	);
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
		if (key.shift && key.tab && !editField) onBack();
	});

	const items = useMemo(
		() => [
			{
				label: `Auto-Save: ${config.autoSave ? 'ON' : 'OFF'}`,
				value: 'autoSave',
			},
			{label: `Save Interval: ${config.saveInterval}ms`, value: 'saveInterval'},
			{label: `Max Sessions: ${config.maxSessions}`, value: 'maxSessions'},
			{label: `Max Messages: ${config.maxMessages}`, value: 'maxMessages'},
			{
				label: `Retention Days: ${config.retentionDays}`,
				value: 'retentionDays',
			},
			{
				label: `Directory: ${config.directory || '(default)'}`,
				value: 'directory',
			},
		],
		[config],
	);

	const persist = <K extends keyof Sessions>(key: K, value: Sessions[K]) => {
		setConfig(prev => ({...prev, [key]: value}));
		updateConfigNestedValue('sessions', key, value);
	};

	const handleSelect = (item: {value: string}) => {
		setError(null);
		if (item.value === 'autoSave') {
			persist('autoSave', !config.autoSave);
			return;
		}
		const key = item.value as keyof Sessions;
		setEditValue(String(config[key] ?? ''));
		setEditField(item.value);
	};

	const submit = (value: string) => {
		if (!editField) return;
		const trimmed = value.trim();
		if (editField === 'directory') {
			persist('directory', trimmed);
			setEditField(null);
			return;
		}
		const num = Number.parseInt(trimmed, 10);
		if (Number.isNaN(num)) return setError('Must be a number');
		const min = NUM_MIN[editField] ?? 1;
		if (num < min) return setError(`Must be at least ${min}`);
		persist(editField as keyof Sessions, num as never);
		setEditField(null);
	};

	return (
		<TitledBoxWithPreferences
			title="Settings · Sessions"
			width={isNarrow ? '100%' : boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{editField ? (
				<Box flexDirection="column">
					<Text color={colors.secondary}>Edit {editField}:</Text>
					<Box marginY={1} borderStyle="round" borderColor={colors.secondary}>
						<TextInput
							value={editValue}
							onChange={setEditValue}
							onSubmit={submit}
						/>
					</Box>
					{error && <Text color={colors.error}>⚠ {error}</Text>}
					<Text color={colors.secondary}>Enter to save · Esc to cancel</Text>
				</Box>
			) : (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={colors.secondary}>
							Enter edits/toggles a field · Shift+Tab back · Esc exit
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
