import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useMemo, useState} from 'react';
import {type CliMode, VALID_MODES} from '@/app/types';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {updateConfigValue} from '@/config/config-writer';
import {loadDefaultMode} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

const MODE_DESCRIPTIONS: Record<string, string> = {
	normal: 'Standard — all tool calls require approval',
	'auto-accept':
		'Semi-auto — most tools auto-run; bash and destructive git prompt',
	yolo: 'Fully automatic — no confirmations at all',
	plan: 'Read-only exploration — only read/search/list tools',
};

/**
 * Default development mode for new sessions. Persists atomically to
 * nanocoder.defaultMode in agents.config.json.
 */
export function SettingsDefaultModePanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const currentMode = loadDefaultMode();
	const [selectedMode, setSelectedMode] = useState<CliMode | undefined>(
		currentMode,
	);

	useInput((_, key) => {
		if (key.escape) onCancel();
		if (key.shift && key.tab) onBack();
	});

	const items = useMemo(
		() =>
			(VALID_MODES as readonly string[]).map(mode => ({
				label: `${mode}${selectedMode === mode ? ' *' : ''}`,
				value: mode,
			})),
		[selectedMode],
	);

	const initialIndex = useMemo(() => {
		const idx = selectedMode
			? (VALID_MODES as readonly string[]).indexOf(selectedMode)
			: 0;
		return idx >= 0 ? idx : 0;
	}, [selectedMode]);

	const handleSelect = (item: {value: string}) => {
		const mode = item.value as CliMode;
		updateConfigValue('defaultMode', mode);
		setSelectedMode(mode);
		onBack();
	};

	return (
		<TitledBoxWithPreferences
			title="Settings · Default Mode"
			width={isNarrow ? '100%' : boxWidth}
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
			{/* Label and description are separate rows: as one long string they
			    wrapped with no hanging indent, so continuation lines ran flush
			    left and the list read as a jumble on narrow terminals. */}
			<SelectInput
				items={items}
				initialIndex={initialIndex}
				onSelect={handleSelect}
				itemComponent={({isSelected, label}) => {
					const mode = label.replace(' *', '');
					const description = MODE_DESCRIPTIONS[mode] ?? '';
					const color = isSelected ? colors.primary : colors.text;
					if (isNarrow) {
						return (
							<Box flexDirection="column">
								<Text color={color}>{label}</Text>
								<Text color={colors.secondary} wrap="truncate-end">
									{'  '}
									{description}
								</Text>
							</Box>
						);
					}
					return (
						<Text wrap="truncate-end">
							<Text color={color}>{label}</Text>
							<Text color={colors.secondary}> — {description}</Text>
						</Text>
					);
				}}
			/>
			<Box marginTop={1}>
				<Text color={colors.secondary}>
					Enter to apply · Shift+Tab back · Esc back
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
