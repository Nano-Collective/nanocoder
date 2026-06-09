import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useMemo, useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

type Action = 'keep' | 'discard';

interface KeepDiscardPromptProps {
	/** Called when user chooses to keep the changes */
	onKeep: () => void;
	/** Called when user chooses to discard the changes */
	onDiscard: () => void;
	/** Optional label describing what changes are pending */
	changesLabel?: string;
}

export function KeepDiscardPrompt({
	onKeep,
	onDiscard,
	changesLabel = 'settings',
}: KeepDiscardPromptProps) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const [selectedIndex, setSelectedIndex] = useState(0);

	const items = useMemo(
		() => [
			{label: `Keep ${changesLabel}`, value: 'keep' as Action},
			{label: `Discard ${changesLabel}`, value: 'discard' as Action},
		],
		[changesLabel],
	);

	useInput((_, key) => {
		if (key.return) {
			const action = items[selectedIndex]?.value;
			if (action === 'keep') {
				onKeep();
			} else if (action === 'discard') {
				onDiscard();
			}
		}
	});

	const title = isNarrow ? 'Changes' : 'Unsaved Changes';

	return (
		<TitledBoxWithPreferences
			title={title}
			width={isNarrow ? '100%' : boxWidth}
			borderColor={colors.warning}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{!isNarrow && (
				<Box marginBottom={1}>
					<Text color={colors.warning}>
						You have unsaved changes. What would you like to do?
					</Text>
				</Box>
			)}
			{isNarrow && <Text color={colors.warning}>Unsaved changes:</Text>}
			<SelectInput
				items={items.map(item => ({
					label: item.value === 'keep' ? `✓ ${item.label}` : `✗ ${item.label}`,
					value: item.value,
				}))}
				initialIndex={0}
				onHighlight={item => setSelectedIndex(items.indexOf(item))}
				indicatorComponent={({isSelected}) => (
					<Text color={isSelected ? colors.primary : colors.text}>
						{isSelected ? '> ' : '  '}
					</Text>
				)}
				itemComponent={({isSelected, label}) => (
					<Text color={isSelected ? colors.primary : colors.text}>{label}</Text>
				)}
			/>
			<Box marginTop={isNarrow ? 0 : 1}>
				<Text color={colors.secondary}>
					{isNarrow ? 'Enter to confirm' : '↑↓ to select · Enter to confirm'}
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
