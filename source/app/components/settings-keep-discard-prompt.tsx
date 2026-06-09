import {Box, Text} from 'ink';
import SelectInput from 'ink-select-input';
import {useMemo} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

type Action = 'keep' | 'discard';

interface KeepDiscardPromptProps {
	/** Called when user chooses to keep the changes */
	onKeep: () => void;
	/** Called when user chooses to discard the changes */
	onDiscard: () => void;
	/** Description of what changed, shown to the user */
	changesSummary?: string;
}

export function KeepDiscardPrompt({
	onKeep,
	onDiscard,
	changesSummary,
}: KeepDiscardPromptProps) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	const items = useMemo(
		() => [
			{label: 'Keep changes', value: 'keep' as Action},
			{label: 'Discard changes', value: 'discard' as Action},
		],
		[],
	);

	const handleSelect = (item: {value: Action}) => {
		if (item.value === 'keep') {
			onKeep();
		} else {
			onDiscard();
		}
	};

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
					<Text color={colors.warning}>You have unsaved changes.</Text>
					{changesSummary && (
						<Text color={colors.secondary}>{changesSummary}</Text>
					)}
					<Text color={colors.warning}>What would you like to do?</Text>
				</Box>
			)}
			{isNarrow && <Text color={colors.warning}>Unsaved changes:</Text>}
			{isNarrow && changesSummary && (
				<Text color={colors.secondary}>{changesSummary}</Text>
			)}
			<SelectInput
				items={items}
				initialIndex={0}
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
			<Box marginTop={isNarrow ? 0 : 1}>
				<Text color={colors.secondary}>
					{isNarrow ? 'Enter to confirm' : '↑↓ to select · Enter to confirm'}
				</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
