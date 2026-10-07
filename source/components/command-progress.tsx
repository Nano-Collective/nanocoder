import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useTheme} from '@/hooks/useTheme';

export interface CommandProgressProps {
	/** Present-tense description of the in-flight work, e.g. "Generating commit message". */
	label: string;
}

/**
 * Live-slot spinner for slash commands that do slow work (LLM round-trips,
 * network calls) before returning their result component. Commands opt in by
 * declaring `progressLabel` in the lazy registry; `handleBuiltInCommand`
 * mounts this into the live slot for the duration of the handler.
 */
export default function CommandProgress({label}: CommandProgressProps) {
	const {colors} = useTheme();
	return (
		<Box marginBottom={1}>
			<Spinner type="dots" />
			<Text color={colors.secondary}> {label}...</Text>
		</Box>
	);
}
