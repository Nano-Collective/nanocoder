import {Box, Text} from 'ink';
import {useTheme} from '@/hooks/useTheme';

/**
 * Label-on-its-own-line, value beneath. Shared across `/agents show`,
 * `/skills show`, `/commands show` etc. so detail pages look the same.
 *
 * The label uses `colors.primary` + bold; the value uses `colors.secondary`
 * and wraps. Pass an optional `marginBottom` to control spacing between
 * stacked fields (default 1 row).
 */
export function InfoField({
	label,
	value,
	marginBottom = 1,
}: {
	label: string;
	value: string;
	marginBottom?: number;
}): React.ReactElement {
	const {colors} = useTheme();
	return (
		<Box flexDirection="column" marginBottom={marginBottom}>
			<Text color={colors.primary} bold>
				{label}
			</Text>
			<Text color={colors.secondary} wrap="wrap">
				{value}
			</Text>
		</Box>
	);
}
