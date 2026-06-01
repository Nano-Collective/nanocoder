import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';

/**
 * A single `Label: value` row in a tool formatter. A row with an `undefined`
 * value is skipped, which is how optional rows (e.g. the trailing "Result:"
 * line that only appears once the tool has run) are expressed.
 */
export interface ToolFormatterRow {
	label: string;
	value: string | undefined;
}

/**
 * Build a formatter for the common tool-output shape: a `⚒ <tool_name>` header
 * followed by a column of `Label: value` rows, wrapped in a borderless
 * `ToolMessage`. Tools whose output needs richer rendering (syntax-highlighted
 * diffs, colour-coded stats, etc.) should keep their bespoke formatter.
 *
 * `getRows` is called with the tool args and (once available) its string
 * result, so the same definition covers both the pre- and post-execution
 * render.
 */
export function makeSimpleToolFormatter<A>(
	toolName: string,
	getRows: (args: A, result?: string) => ToolFormatterRow[],
): (args: A, result?: string) => React.ReactElement {
	const Formatter = React.memo(({args, result}: {args: A; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext is required');
		}
		const {colors} = themeContext;

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ {toolName}</Text>

				{getRows(args, result).map(row =>
					row.value === undefined ? null : (
						<Box key={row.label}>
							<Text color={colors.secondary}>{row.label}: </Text>
							<Text wrap="truncate-end" color={colors.text}>
								{row.value}
							</Text>
						</Box>
					),
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	});

	return (args: A, result?: string): React.ReactElement => (
		<Formatter args={args} result={result} />
	);
}
