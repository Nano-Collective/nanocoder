import {Box, Text} from 'ink';
import {useTheme} from '@/hooks/useTheme';
import type {InputState} from '@/types/hooks';

/**
 * The composer's input row during Ctrl+R search: the query, the matched
 * prompt, and a key hint. An empty query is not a failed search.
 */
export function ReverseSearchPrompt({
	query,
	match,
	matchColor,
}: {
	query: string;
	match: InputState | null;
	/** Colour of the matched prompt's text (the composer's text colour). */
	matchColor: string;
}) {
	const {colors} = useTheme();
	const found = match !== null || query === '';
	const labelColor = found ? colors.info : colors.error;
	return (
		<Box flexDirection="column">
			<Box>
				<Text color={labelColor} bold>
					{found ? '(reverse-i-search)`' : '(failed reverse-i-search)`'}
				</Text>
				<Text color={colors.primary} bold>
					{query}
				</Text>
				<Text color={labelColor} bold>
					{"': "}
				</Text>
				<Text color={match ? matchColor : colors.secondary}>
					{match ? match.displayValue : ''}
				</Text>
			</Box>
			<Text color={colors.secondary}>
				Enter: select · Esc: cancel · Ctrl+R: cycle older
			</Text>
		</Box>
	);
}
