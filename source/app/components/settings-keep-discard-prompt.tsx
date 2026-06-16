import {Box, Text} from 'ink';
import SelectInput from 'ink-select-input';
import {useMemo} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

type Action = 'keep' | 'discard';

export interface ChangeDiff {
	/** Human-readable setting name */
	setting: string;
	/** Previous value as a short string */
	oldValue: string;
	/** New value as a short string */
	newValue: string;
	/**
	 * Called by handleKeep to flush a deferred disk write.
	 * Used by pure-config panels that defer persistence until confirmed.
	 */
	persist?: () => void;
	/**
	 * Called by handleDiscard to undo an already-applied change.
	 * Used by context-integrated panels (Theme, Title Shape) where the
	 * context setter writes to disk immediately and cannot be deferred.
	 */
	revert?: () => void;
}

interface KeepDiscardPromptProps {
	/** Called when user chooses to keep the changes */
	onKeep: () => void;
	/** Called when user chooses to discard the changes */
	onDiscard: () => void;
	/** List of changed settings with old/new values */
	changes?: ChangeDiff[];
}

export function KeepDiscardPrompt({
	onKeep,
	onDiscard,
	changes,
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
				<>
					<Box marginBottom={1}>
						<Text color={colors.warning}>You have unsaved changes.</Text>
					</Box>
					{changes && changes.length > 0 && (
						<Box flexDirection="column" marginBottom={1}>
							{changes.map((c, i) => (
								<Box key={i}>
									<Text color={colors.secondary}>{c.setting}</Text>
									<Text color={colors.text}> : </Text>
									<Text color={colors.secondary}>{c.oldValue}</Text>
									<Text color={colors.secondary}> → </Text>
									<Text color={colors.primary}>{c.newValue}</Text>
								</Box>
							))}
						</Box>
					)}
					<Box marginBottom={1}>
						<Text color={colors.warning}>What would you like to do?</Text>
					</Box>
				</>
			)}
			{isNarrow && (
				<>
					<Text color={colors.warning}>Unsaved changes:</Text>
					{changes &&
						changes.length > 0 &&
						changes.map((c, i) => (
							<Text key={i} color={colors.secondary}>
								{c.setting}: {c.oldValue} → {c.newValue}
							</Text>
						))}
				</>
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
