import {Box, Text} from 'ink';

const browserHint = 'Open this URL in your browser. Ctrl+C stops the server.';

/** Match wrapped footer text when budgeting the welcome screen's height. */
export function getWebModeFooterRows(
	url: string | undefined,
	columns: number,
): number {
	if (!url) return 0;
	const width = Math.max(1, columns - 4);
	return (
		1 +
		Math.ceil(`Web mode: ${url}`.length / width) +
		Math.ceil(browserHint.length / width)
	);
}

export function WebModeFooter({url}: {url: string}) {
	return (
		<Box flexDirection="column" flexShrink={0} paddingLeft={4} marginTop={1}>
			<Text>Web mode: {url}</Text>
			<Text dimColor>{browserHint}</Text>
		</Box>
	);
}
