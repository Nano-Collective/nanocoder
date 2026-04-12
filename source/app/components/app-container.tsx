import {Box, Text} from 'ink';
import React from 'react';
import WelcomeMessage from '@/components/welcome-message';
import {getClosestConfigFile} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

export interface AppContainerProps {
	shouldShowWelcome: boolean;
	currentProvider: string;
	currentModel: string;
}

/**
 * Minimal one-liner showing provider/model + config path. Replaces the
 * old full Status box which rendered inside Ink's <Static> and couldn't
 * update after first paint. Run /status for the full picture.
 */
function BootSummary({
	provider,
	model,
}: {
	provider: string;
	model: string;
}): React.ReactElement {
	const {colors} = useTheme();
	const {isNarrow} = useResponsiveTerminal();
	const configPath = getClosestConfigFile('agents.config.json');
	const homedir = process.env.HOME || process.env.USERPROFILE || '';
	const shortConfig = homedir ? configPath.replace(homedir, '~') : configPath;

	// Narrow terminals: just provider + model, skip the config path
	if (isNarrow) {
		return provider && model ? (
			<Text>
				<Text color={colors.success} bold>
					{provider}
				</Text>
				<Text color={colors.secondary}> · </Text>
				<Text color={colors.success}>{model}</Text>
			</Text>
		) : (
			<></>
		);
	}

	return (
		<Text color={colors.secondary}>
			{provider && model ? (
				<>
					<Text color={colors.success} bold>
						{provider}
					</Text>
					<Text color={colors.secondary}> · </Text>
					<Text color={colors.success}>{model}</Text>
					<Text color={colors.secondary}> · </Text>
					<Text color={colors.secondary}>{shortConfig}</Text>
				</>
			) : (
				<Text color={colors.secondary}>{shortConfig}</Text>
			)}
		</Text>
	);
}

/**
 * Creates static components for the app container (welcome banner +
 * one-line boot summary).
 *
 * The full Status box was removed from startup — it rendered inside Ink's
 * <Static> which freezes after first paint, so background work (MCP, LSP,
 * update check) never showed. Users can run /status any time to see the
 * full picture.
 */
export function createStaticComponents({
	shouldShowWelcome,
	currentProvider,
	currentModel,
}: AppContainerProps): React.ReactNode[] {
	const components: React.ReactNode[] = [];

	if (shouldShowWelcome) {
		components.push(<WelcomeMessage key="welcome" />);
	}

	if (currentProvider || currentModel) {
		components.push(
			<Box key="boot-summary" flexDirection="column" marginBottom={1}>
				<BootSummary provider={currentProvider} model={currentModel} />
			</Box>,
		);
	}

	return components;
}
