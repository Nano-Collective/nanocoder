import {Box, Text} from 'ink';
import {useMemo} from 'react';
import {completionWindow} from '@/components/composer/completion-window';
import {useTheme} from '@/hooks/useTheme';
import type {Completion} from '@/types/index';

const MAX_COMMAND_COMPLETION_ROWS = 10;

/** The slash-command menu, windowed around the highlighted entry. */
export function CommandCompletionList({
	completions,
	selectedIndex,
}: {
	completions: Completion[];
	selectedIndex: number;
}) {
	const {colors} = useTheme();
	const visible = useMemo(
		() =>
			completionWindow(completions, selectedIndex, MAX_COMMAND_COMPLETION_ROWS),
		[completions, selectedIndex],
	);
	return (
		<Box flexDirection="column" marginTop={1}>
			<Text color={colors.secondary}>Available commands:</Text>
			{visible.items.map((completion, index) => {
				const isSelected = visible.start + index === selectedIndex;
				return (
					<Text
						key={`${completion.isCustom ? 'custom' : 'built-in'}-${completion.name}`}
						color={
							isSelected
								? colors.info
								: completion.isCustom
									? colors.info
									: colors.primary
						}
						bold={isSelected}
					>
						{isSelected ? '▸ ' : '  '}/{completion.name}
					</Text>
				);
			})}
			{completions.length > MAX_COMMAND_COMPLETION_ROWS && (
				<Text color={colors.secondary}>
					Showing {visible.start + 1}-{visible.end} of {completions.length}
				</Text>
			)}
		</Box>
	);
}
