import {Box, Text} from 'ink';
import React from 'react';
import WelcomeMessage from '@/components/welcome-message';
import {getClosestConfigFile} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {
	formatGitStatusSummary,
	type GitStatusSummary,
	getGitStatusSummarySync,
} from '@/tools/git/utils';
import {DEVELOPMENT_MODE_LABELS, type DevelopmentMode} from '@/types/core';

/**
 * Format a {@link GitStatusSummary} for inline display next to the
 * provider/model/config segment of the boot summary.
 */
export function formatBootSummaryGitLabel(status: GitStatusSummary): string {
	const {branch, marker} = formatGitStatusSummary(status);
	return marker ? `⎇ ${branch} (${marker})` : `⎇ ${branch}`;
}

export interface AppContainerProps {
	shouldShowWelcome: boolean;
	currentProvider: string;
	currentModel: string;
	/**
	 * When true, drop the welcome banner and render a mode-aware header
	 * (provider · model · mode · config) so run-mode output makes it
	 * obvious what the agent is executing under.
	 */
	nonInteractiveMode?: boolean;
	/**
	 * Development mode to display in the header. Only surfaced when
	 * `nonInteractiveMode` is true (interactive mode has a live status bar).
	 */
	developmentMode?: DevelopmentMode;
}

/**
 * Minimal one-liner showing provider/model (+ optional mode) + config path.
 * Replaces the old full Status box which rendered inside Ink's <Static> and
 * couldn't update after first paint. Run /status for the full picture.
 */
function BootSummary({
	provider,
	model,
	mode,
}: {
	provider: string;
	model: string;
	mode?: DevelopmentMode;
}): React.ReactElement {
	const {colors} = useTheme();
	const {isNarrow} = useResponsiveTerminal();
	const configPath = getClosestConfigFile('agents.config.json');
	const homedir = process.env.HOME || process.env.USERPROFILE || '';
	const shortConfig = homedir ? configPath.replace(homedir, '~') : configPath;
	const modeLabel = mode ? DEVELOPMENT_MODE_LABELS[mode] : undefined;
	const gitStatus = getGitStatusSummarySync();
	const gitLabel = gitStatus ? formatBootSummaryGitLabel(gitStatus) : undefined;

	// Narrow terminals: provider + model + mode on the first line, with the
	// branch (when present) underneath so the line doesn't overflow.
	if (isNarrow) {
		if (!provider || !model) return <></>;
		return (
			<Box flexDirection="column">
				<Text>
					<Text color={colors.success} bold>
						{provider}
					</Text>
					<Text color={colors.secondary}> · </Text>
					<Text color={colors.success}>{model}</Text>
					{modeLabel && (
						<>
							<Text color={colors.secondary}> · </Text>
							<Text color={colors.info}>{modeLabel}</Text>
						</>
					)}
				</Text>
				{gitLabel && <Text color={colors.primary}>{gitLabel}</Text>}
			</Box>
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
					{modeLabel && (
						<>
							<Text color={colors.secondary}> · </Text>
							<Text color={colors.info}>{modeLabel}</Text>
						</>
					)}
					<Text color={colors.secondary}> · </Text>
					<Text color={colors.secondary}>{shortConfig}</Text>
					{gitLabel && (
						<>
							<Text color={colors.secondary}> · </Text>
							<Text color={colors.primary}>{gitLabel}</Text>
						</>
					)}
				</>
			) : (
				<>
					<Text color={colors.secondary}>{shortConfig}</Text>
					{gitLabel && (
						<>
							<Text color={colors.secondary}> · </Text>
							<Text color={colors.primary}>{gitLabel}</Text>
						</>
					)}
				</>
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
	nonInteractiveMode = false,
	developmentMode,
}: AppContainerProps): React.ReactNode[] {
	const components: React.ReactNode[] = [];

	if (shouldShowWelcome) {
		components.push(<WelcomeMessage key="welcome" />);
	}

	// Boot summary header: always in interactive mode (for config path
	// visibility), and in run mode we include the active development mode
	// so it's obvious what the agent is executing under.
	if (currentProvider || currentModel) {
		components.push(
			<Box key="boot-summary" flexDirection="column" marginBottom={1}>
				<BootSummary
					provider={currentProvider}
					model={currentModel}
					mode={nonInteractiveMode ? developmentMode : undefined}
				/>
			</Box>,
		);
	}

	return components;
}
