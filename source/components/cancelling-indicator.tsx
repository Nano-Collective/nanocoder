import {memo} from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useTheme} from '@/hooks/useTheme';

export default memo(function CancellingIndicator() {
	const {colors} = useTheme();
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box>
				<Spinner type="dots" />
				<Text color={colors.secondary}> Cancelling...</Text>
			</Box>
		</Box>
	);
});
