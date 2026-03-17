/**
 * Subagent Activity Component
 *
 * Displays visual indication when a subagent is active.
 */

import {Text} from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';

export interface SubagentActivityProps {
	subagentName: string | null;
	description: string | null;
	startTime: number | null;
}

export const SubagentActivity: React.FC<SubagentActivityProps> = ({
	subagentName,
	description,
	startTime,
}) => {
	if (!subagentName) {
		return null;
	}

	// Calculate elapsed time
	const elapsed = startTime ? Date.now() - startTime : 0;
	const elapsedSeconds = (elapsed / 1000).toFixed(1);

	return (
		<Text>
			<Text dimColor>[</Text>
			<Text bold color="cyan">
				🤖 {subagentName}
			</Text>
			<Text dimColor>]</Text>
			<Text dimColor> {description}</Text>
			<Text dimColor> </Text>
			<Spinner type="dots" />
			<Text dimColor> ({elapsedSeconds}s)</Text>
		</Text>
	);
};
