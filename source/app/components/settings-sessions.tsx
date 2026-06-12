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
import type {ChangeDiff} from './settings-keep-discard-prompt';

interface SettingsSessionsPanelProps {
	onBack: () => void;
	onCancel: () => void;
	onChanged?: (diff: ChangeDiff) => void;
}

const DEFAULT_SESSIONS: NonNullable<AppConfig['sessions']> = {
	autoSave: true,
	saveInterval: 30000,
	maxSessions: 100,
	maxMessages: 1000,
	retentionDays: 30,
	directory: '',
};

export function SettingsSessionsPanel({
	onBack,
	onCancel,
	onChanged,
}: SettingsSessionsPanelProps) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const currentSessions = getAppConfig().sessions ?? DEFAULT_SESSIONS;
	const [config, setConfig] =
		useState<NonNullable<AppConfig['sessions']>>(currentSessions);
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
				label: `Auto-Save: ${config.autoSave ? 'ON' : 'OFF'}`,
				value: 'autoSave' as const,
			},
			{
				label: `Save Interval: ${config.saveInterval ?? 30000}ms (${Math.round((config.saveInterval ?? 30000) / 1000)}s)`,
				value: 'saveInterval' as const,
			},
			{
				label: `Max Sessions: ${config.maxSessions}`,
				value: 'maxSessions' as const,
			},
			{
				label: `Max Messages: ${config.maxMessages}`,
				value: 'maxMessages' as const,
			},
			{
				label: `Retention: ${config.retentionDays} days`,
				value: 'retentionDays' as const,
			},
			{
				label: `Directory: ${config.directory || '(default)'}`,
				value: 'directory' as const,
			},
		];
	}, [config]);

	const handleSelect = (item: {value: string}) => {
		setError(null);
		if (item.value === 'autoSave') {
			const next = {...config, autoSave: !config.autoSave};
			setConfig(next);
			onChanged?.({
				setting: 'Auto-Save',
				oldValue: config.autoSave ? 'ON' : 'OFF',
				newValue: next.autoSave ? 'ON' : 'OFF',
				persist: () =>
					updateConfigNestedValue('sessions', 'autoSave', next.autoSave),
			});
		} else {
			// Open text input for numeric/path fields
			setEditField(item.value);
			setEditValue(String(config[item.value as keyof typeof config] ?? ''));
		}
	};

	const handleFieldSubmit = (value: string) => {
		if (!editField) return;

		setError(null);
		const trimmed = value.trim();

		// Numeric fields
		if (
			editField === 'saveInterval' ||
			editField === 'maxSessions' ||
			editField === 'maxMessages' ||
			editField === 'retentionDays'
		) {
			const num = parseInt(trimmed, 10);
			if (isNaN(num)) {
				setError('Must be a number');
				return;
			}

			// Validate minimums
			const minMap: Record<string, number> = {
				saveInterval: 1000,
				maxSessions: 1,
				maxMessages: 1,
				retentionDays: 1,
			};
			const min = minMap[editField];
			if (num < min) {
				setError(`Minimum value is ${min}`);
				return;
			}

			const capturedField = editField;
			const next = {...config, [capturedField]: num};
			setConfig(next);
			const fieldNames: Record<string, string> = {
				saveInterval: 'Save Interval',
				maxSessions: 'Max Sessions',
				maxMessages: 'Max Messages',
				retentionDays: 'Retention Days',
			};
			onChanged?.({
				setting: fieldNames[capturedField] ?? capturedField,
				oldValue: String(config[capturedField as keyof typeof config]),
				newValue: String(num),
				persist: () => updateConfigNestedValue('sessions', capturedField, num),
			});
		} else if (editField === 'directory') {
			const next = {...config, directory: trimmed};
			setConfig(next);
			onChanged?.({
				setting: 'Session Directory',
				oldValue: config.directory || '(default)',
				newValue: trimmed || '(default)',
				persist: () =>
					updateConfigNestedValue('sessions', 'directory', trimmed),
			});
		}

		setEditField(null);
	};

	const fieldLabels: Record<string, string> = {
		saveInterval: 'Save interval (ms, min 1000)',
		maxSessions: 'Max sessions to keep (min 1)',
		maxMessages: 'Max messages per session (min 1)',
		retentionDays: 'Retention days (min 1)',
		directory: 'Custom session directory (leave empty for default)',
	};

	const title = isNarrow ? 'Sessions' : 'Settings · Sessions';

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
				{editField ? (
					<Box flexDirection="column">
						<Text color={colors.secondary}>{fieldLabels[editField]}</Text>
						<Box
							marginBottom={1}
							borderStyle="round"
							borderColor={colors.secondary}
						>
							<TextInput
								value={editValue}
								onChange={setEditValue}
								onSubmit={handleFieldSubmit}
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
			{editField ? (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={colors.secondary}>{fieldLabels[editField]}</Text>
					</Box>
					<Box
						marginBottom={1}
						borderStyle="round"
						borderColor={colors.secondary}
					>
						<TextInput
							value={editValue}
							onChange={setEditValue}
							onSubmit={handleFieldSubmit}
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
							Auto-Save toggles with Enter. Other fields open text input.
							Shift+Tab back, Esc exit.
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
							Enter to edit, Shift+Tab to go back, Esc to exit
						</Text>
					</Box>
				</Box>
			)}
		</TitledBoxWithPreferences>
	);
}
