import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useMemo, useState} from 'react';
import {type CliMode, VALID_MODES} from '@/app/types';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {updateConfigValue} from '@/config/config-writer';
import {loadDefaultMode} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {ChangeDiff} from './settings-keep-discard-prompt';

const MODE_DESCRIPTIONS: Record<string, string> = {
	normal: 'Standard — all tool calls require approval',
	'auto-accept': 'Semi-auto — read-only tools auto-run; writes prompt',
	yolo: 'Fully automatic — no confirmations at all',
	plan: 'Read-only exploration — only read/search/list tools',
};

interface SettingsDefaultModePanelProps {
	onBack: () => void;
	onCancel: () => void;
	onChanged?: (diff: ChangeDiff) => void;
}

export function SettingsDefaultModePanel({
	onBack,
	onCancel,
	onChanged,
}: SettingsDefaultModePanelProps) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const currentMode = loadDefaultMode();
	const [selectedMode, setSelectedMode] = useState<CliMode | undefined>(
		currentMode,
	);

	useInput((_, key) => {
		if (key.escape) {
			onCancel();
		}
		if (key.shift && key.tab) {
			onBack();
		}
	});

	const items = useMemo(() => {
		return (VALID_MODES as readonly string[]).map(mode => ({
			label:
				selectedMode === mode
					? `${mode} * — ${MODE_DESCRIPTIONS[mode] ?? ''}`
					: `${mode} — ${MODE_DESCRIPTIONS[mode] ?? ''}`,
			value: mode,
		}));
	}, [selectedMode]);

	const initialIndex = useMemo(() => {
		if (!selectedMode) return 0;
		const idx = (VALID_MODES as readonly string[]).indexOf(selectedMode);
		return idx >= 0 ? idx : 0;
	}, [selectedMode]);

	const handleSelect = (item: {value: string}) => {
		const mode = item.value as CliMode;
		onChanged?.({
			setting: 'Default Mode',
			oldValue: currentMode ?? 'normal',
			newValue: mode,
			persist: () => updateConfigValue('defaultMode', mode),
		});
		setSelectedMode(mode);
		onBack();
	};

	if (isNarrow) {
		return (
			<TitledBoxWithPreferences
				title="Settings · Default Mode"
				width="100%"
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
				flexDirection="column"
				marginBottom={1}
			>
				<Text color={colors.secondary}>
					Current: {currentMode ?? '(not set — defaults to normal)'}
				</Text>
				<SelectInput
					items={items}
					initialIndex={initialIndex}
					onSelect={handleSelect}
				/>
				<Box marginBottom={1}></Box>
				<Text color={colors.secondary}>Enter/Shift+Tab/Esc</Text>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Settings · Default Mode"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					Initial development mode for new sessions. Current:{' '}
					{currentMode ?? '(not set — defaults to normal)'}
				</Text>
			</Box>
			<SelectInput
				items={items}
				initialIndex={initialIndex}
				onSelect={handleSelect}
			/>
			<Box marginTop={1}>
				<Text color={colors.secondary}>
					Enter to apply, Shift+Tab to go back, Esc to exit
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
