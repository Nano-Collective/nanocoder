import {Box, Text, useInput} from 'ink';
import {useMemo} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

/**
 * Read-only view of the active NANOCODER_* environment variables. These are set
 * externally and override config; shown here so they're discoverable.
 */
export function SettingsEnvironmentPanel({
	onBack,
	onCancel,
}: {
	onBack: () => void;
	onCancel: () => void;
}) {
	const {colors} = useTheme();
	const {boxWidth, isNarrow} = useResponsiveTerminal();

	useInput((_, key) => {
		if (key.escape) onCancel();
		if (key.shift && key.tab) onBack();
	});

	const vars = useMemo(
		() =>
			Object.entries(process.env)
				.filter(([k]) => k.startsWith('NANOCODER_'))
				.sort(([a], [b]) => a.localeCompare(b)),
		[],
	);

	return (
		<TitledBoxWithPreferences
			title="Settings · Environment"
			width={isNarrow ? '100%' : boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.secondary}>
					Active NANOCODER_* variables (read-only, set outside the app).
				</Text>
			</Box>
			{vars.length === 0 ? (
				<Text color={colors.text}>(none set)</Text>
			) : (
				vars.map(([k, v]) => (
					<Text key={k} color={colors.text}>
						<Text color={colors.primary}>{k}</Text>
						<Text color={colors.secondary}>={v}</Text>
					</Text>
				))
			)}
			<Box marginTop={1}>
				<Text color={colors.secondary}>Shift+Tab back · Esc exit</Text>
			</Box>
		</TitledBoxWithPreferences>
	);
}
