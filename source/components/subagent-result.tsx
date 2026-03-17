/**
 * Subagent Result Component
 *
 * Displays the result from a subagent execution.
 */

import {Box, Text} from 'ink';
import React from 'react';

export interface SubagentResultProps {
	subagentName: string;
	description: string;
	result: string;
	executionTimeMs: number;
}

export const SubagentResult: React.FC<SubagentResultProps> = ({
	subagentName,
	description,
	result,
	executionTimeMs,
}) => {
	const executionTime = (executionTimeMs / 1000).toFixed(2);

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text dimColor>┌─ Subagent: {subagentName}</Text>
			<Text dimColor>│</Text>
			<Text dimColor>│ Task: {description}</Text>
			<Text dimColor>│ Result:</Text>
			<Text dimColor>│</Text>
			{result
				.split('\n')
				.slice(0, 5)
				.map((line, i) => (
					<Text key={i} dimColor>
						│ {line}
					</Text>
				))}
			{result.split('\n').length > 5 && (
				<Text dimColor>│ ... ({result.split('\n').length - 5} more lines)</Text>
			)}
			<Text dimColor>│</Text>
			<Text dimColor>└─ Completed in {executionTime}s</Text>
		</Box>
	);
};
