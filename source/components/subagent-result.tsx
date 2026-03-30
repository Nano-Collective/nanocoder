/**
 * Subagent Result Component
 *
 * Displays the result from a subagent execution.
 */

import {Box, Text} from 'ink';
import React from 'react';

/** Maximum number of lines to display before truncating */
const MAX_DISPLAY_LINES = 50;

export interface SubagentResultProps {
	subagentName: string;
	description: string;
	result: string;
	executionTimeMs: number;
	/** Maximum lines to display (default: 50) */
	maxLines?: number;
}

export const SubagentResult: React.FC<SubagentResultProps> = ({
	subagentName,
	description,
	result,
	executionTimeMs,
	maxLines = MAX_DISPLAY_LINES,
}) => {
	const executionTime = (executionTimeMs / 1000).toFixed(2);
	const lines = result.split('\n');
	const displayLines = lines.slice(0, maxLines);
	const hasMoreLines = lines.length > maxLines;

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text dimColor>┌─ Subagent: {subagentName}</Text>
			<Text dimColor>│</Text>
			<Text dimColor>│ Task: {description}</Text>
			<Text dimColor>│ Result:</Text>
			<Text dimColor>│</Text>
			{displayLines.map((line, i) => (
				<Text key={i} dimColor>
					│ {line}
				</Text>
			))}
			{hasMoreLines && (
				<Text dimColor>│ ... ({lines.length - maxLines} more lines)</Text>
			)}
			<Text dimColor>│</Text>
			<Text dimColor>└─ Completed in {executionTime}s</Text>
		</Box>
	);
};
