import {Text} from 'ink';
import {useTheme} from '@/hooks/useTheme';

/**
 * Marks a tool result whose text came from outside the workspace: a web page, a
 * search result, a rendered page, or an MCP server.
 *
 * The model already receives the same boundary in the payload (the
 * `<external_content>` frame). This is the human half: the user is the one who
 * needs to see which results were a stranger's text, so the notice follows the
 * result however it is displayed - compact, full, or through `/expand`.
 */
export function ExternalContentNotice() {
	const {colors} = useTheme();
	return (
		<Text color={colors.warning}>
			{' '}
			{'\u26a0'} external content · treated as data
		</Text>
	);
}
