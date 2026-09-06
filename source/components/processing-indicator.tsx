import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {memo, useEffect, useState} from 'react';
import {useTheme} from '@/hooks/useTheme';

export interface ProcessingIndicatorProps {
	model?: string;
	/** Custom static label to display instead of the dynamic progression */
	label?: string;
}

const PHRASES = [
	'Thinking',
	'Planning',
	'Reading',
	'Working',
	'Preparing response',
];

const PHRASE_INTERVAL_MS = 3500;

export const ProcessingIndicator = memo(function ProcessingIndicator({
	model,
	label,
}: ProcessingIndicatorProps) {
	const {colors} = useTheme();
	const [phraseIndex, setPhraseIndex] = useState(0);

	useEffect(() => {
		if (label) return;

		const timer = setInterval(() => {
			setPhraseIndex(prev => (prev + 1) % PHRASES.length);
		}, PHRASE_INTERVAL_MS);

		if (timer.unref) {
			timer.unref();
		}

		return () => clearInterval(timer);
	}, [label]);

	const currentPhrase = label ?? PHRASES[phraseIndex];

	return (
		<Box marginBottom={1} marginTop={1} flexDirection="column">
			<Box>
				<Text color={colors.info} bold>
					<Spinner type="dots" /> {currentPhrase}
				</Text>
				{model && <Text color={colors.secondary}> ({model})</Text>}
				<Text color={colors.secondary}> · Esc to cancel</Text>
			</Box>
		</Box>
	);
});

export default ProcessingIndicator;
