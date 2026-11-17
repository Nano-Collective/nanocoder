import {Box, Text} from 'ink';
import {useMemo} from 'react';
import {completionWindow} from '@/components/composer/completion-window';
import {
	decodeMCPResourcePath,
	type MentionCompletion,
} from '@/components/composer/useFileMentions';
import {useTheme} from '@/hooks/useTheme';

const MAX_FILE_COMPLETION_ROWS = 5;

/** The `@` mention suggestions, windowed around the highlighted entry. */
export function FileMentionList({
	completions,
	selectedIndex,
}: {
	completions: MentionCompletion[];
	selectedIndex: number;
}) {
	const {colors} = useTheme();
	const visible = useMemo(
		() =>
			completionWindow(completions, selectedIndex, MAX_FILE_COMPLETION_ROWS),
		[completions, selectedIndex],
	);
	return (
		<Box flexDirection="column" marginTop={1}>
			<Text color={colors.secondary}>
				File suggestions (↑/↓ to navigate, Tab to select):
			</Text>
			{visible.items.map((file, index) => {
				const isSelected = visible.start + index === selectedIndex;
				return (
					<Text
						key={file.path}
						color={isSelected ? colors.info : colors.primary}
						bold={isSelected}
					>
						{isSelected ? '▸ ' : '  '}
						{decodeMCPResourcePath(file.path) ? file.displayPath : file.path}
					</Text>
				);
			})}
			{completions.length > MAX_FILE_COMPLETION_ROWS && (
				<Text color={colors.secondary}>
					Showing {visible.start + 1}-{visible.end} of {completions.length}
				</Text>
			)}
		</Box>
	);
}
