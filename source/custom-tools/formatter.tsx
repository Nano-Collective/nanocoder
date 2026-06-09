import {Box, Text} from 'ink';
import React from 'react';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {ToolFormatter} from '@/types/core';
import {calculateTokens} from '@/utils/token-calculator';

const MAX_VALUE_PREVIEW = 80;

function previewValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') {
		return value.length > MAX_VALUE_PREVIEW
			? `${value.slice(0, MAX_VALUE_PREVIEW)}…`
			: value;
	}
	if (Array.isArray(value)) return `[${value.length} items]`;
	if (typeof value === 'object') return '[object]';
	return String(value);
}

function CustomToolFormatterComponent({
	toolName,
	args,
	result,
}: {
	toolName: string;
	args: Record<string, unknown>;
	result?: string;
}): React.ReactElement {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const argEntries = Object.entries(args ?? {}).filter(
		([, v]) => v !== undefined && v !== null && v !== '',
	);
	const tokens = result ? calculateTokens(result) : 0;
	return (
		<Box flexDirection="column" marginBottom={1} width={boxWidth}>
			<Text color={colors.tool}>⚒ {toolName}</Text>
			{argEntries.length > 0 && (
				<Box flexDirection="column">
					{argEntries.map(([k, v]) => (
						<Box key={k}>
							<Text color={colors.secondary}>{k}: </Text>
							<Box marginLeft={1} flexShrink={1}>
								<Text wrap="truncate-end" color={colors.text}>
									{previewValue(v)}
								</Text>
							</Box>
						</Box>
					))}
				</Box>
			)}
			{result !== undefined && (
				<Box>
					<Text color={colors.secondary}>Output: </Text>
					<Text color={colors.text}>~{tokens} tokens</Text>
				</Box>
			)}
		</Box>
	);
}

/**
 * Default formatter shared by all shell-bodied custom tools.
 * Renders the tool name, the provided args, and (after execution) a token
 * estimate of the output. Matches the visual style of `webSearchFormatter`.
 */
export function makeCustomToolFormatter(toolName: string): ToolFormatter {
	return (args: Record<string, unknown>, result?: string) =>
		React.createElement(CustomToolFormatterComponent, {
			toolName,
			args: args ?? {},
			result,
		});
}
