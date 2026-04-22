import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';
import {useTheme} from '@/hooks/useTheme';

export interface NonInteractiveStatusProps {
	/**
	 * Status line to show. Null means the run is complete — render the
	 * terse "Completed. Exiting." line instead of a spinner.
	 */
	message: string | null;
}

/**
 * Single terse status line used by the non-interactive shell. Replaces the
 * branch that previously lived inside ChatInput for `run` mode.
 */
export function NonInteractiveStatus({
	message,
}: NonInteractiveStatusProps): React.ReactElement {
	const {colors} = useTheme();

	if (message === null) {
		return (
			<Box marginLeft={-1} marginTop={1}>
				<Text color={colors.secondary}>Completed. Exiting.</Text>
			</Box>
		);
	}

	return (
		<Box marginLeft={-1} marginTop={1}>
			<Text color={colors.secondary}>
				<Spinner type="dots" /> {message}
			</Text>
		</Box>
	);
}
