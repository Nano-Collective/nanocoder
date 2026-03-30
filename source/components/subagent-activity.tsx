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
	// Track elapsed time with proper interval updates
	const [elapsed, setElapsed] = React.useState(0);

	React.useEffect(() => {
		if (!startTime) {
			setElapsed(0);
			return;
		}

		// Update immediately
		setElapsed(Date.now() - startTime);

		// Then update every 100ms for smooth display
		const interval = setInterval(() => {
			setElapsed(Date.now() - (startTime || 0));
		}, 100);

		return () => clearInterval(interval);
	}, [startTime]);

	if (!subagentName) {
		return null;
	}

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
