import {existsSync} from 'fs';
import {Box, Text} from 'ink';
import {memo} from 'react';

import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {confDirMap} from '@/config/index';
import {getThemeColors, themes} from '@/config/themes';
import {
	PATH_LENGTH_NARROW_TERMINAL,
	PATH_LENGTH_NORMAL_TERMINAL,
} from '@/constants';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import type {LSPConnectionStatus, MCPConnectionStatus} from '@/types/core';
import type {ThemePreset} from '@/types/ui';
import type {UpdateInfo} from '@/types/utils';

// Get CWD once at module load time
const cwd = process.cwd();

// Using UpdateInfo from '@/types/utils' for type consistency

export default memo(function Status({
	provider,
	model,
	theme,
	updateInfo,
	agentsMdLoaded,
	mcpServersStatus,
	lspServersStatus,
	customCommandsCount,
	preferencesLoaded,
	vscodeMode,
	vscodePort,
	vscodeRequestedPort,
	contextUsage,
	autoCompactInfo,
}: {
	provider: string;
	model: string;
	theme: ThemePreset;
	updateInfo?: UpdateInfo | null;
	agentsMdLoaded?: boolean;
	mcpServersStatus?: MCPConnectionStatus[];
	lspServersStatus?: LSPConnectionStatus[];
	customCommandsCount?: number;
	preferencesLoaded?: boolean;
	vscodeMode?: boolean;
	vscodePort?: number | null;
	vscodeRequestedPort?: number;
	contextUsage?: {
		currentTokens: number;
		contextLimit: number | null;
		percentUsed: number;
	};
	autoCompactInfo?: {
		enabled: boolean;
		threshold: number;
		mode: string;
		hasOverrides: boolean;
	};
}) {
	const {boxWidth, isNarrow, truncatePath} = useResponsiveTerminal();
	const colors = getThemeColors(theme);

	// Check for AGENTS.md synchronously if not provided
	const hasAgentsMd = agentsMdLoaded ?? existsSync(`${cwd}/AGENTS.md`);

	// Connection status calculations
	const mcpStatus = mcpServersStatus || [];
	const lspStatus = lspServersStatus || [];
	const mcpConnected = mcpStatus.filter(s => s.status === 'connected').length;
	const lspConnected = lspStatus.filter(s => s.status === 'connected').length;
	const mcpTotal = mcpStatus.length;
	const lspTotal = lspStatus.length;

	// Get status color
	const getStatusColor = (connected: number, total: number) => {
		if (total === 0) return colors.secondary;
		if (connected === total) return colors.success;
		if (connected > 0) return colors.warning;
		return colors.error;
	};

	// VS Code port status
	const showPortWarning =
		vscodeMode &&
		vscodePort &&
		vscodeRequestedPort &&
		vscodePort !== vscodeRequestedPort;

	// Calculate max path length based on terminal size
	const maxPathLength = isNarrow
		? PATH_LENGTH_NARROW_TERMINAL
		: PATH_LENGTH_NORMAL_TERMINAL;

	return (
		<>
			{/* Narrow terminal: simple text without box */}
			{isNarrow ? (
				<Box
					flexDirection="column"
					marginBottom={1}
					borderStyle="round"
					borderColor={colors.info}
					paddingY={1}
					paddingX={2}
				>
					<Text color={colors.info}>
						<Text bold={true}>CWD: </Text>
						{truncatePath(cwd, maxPathLength)}
					</Text>
					<Text color={colors.success}>
						<Text bold={true}>Model: </Text>
						{model}
					</Text>
					<Text color={colors.primary}>
						<Text bold={true}>Theme: </Text>
						{themes[theme].displayName}
					</Text>
					{hasAgentsMd ? (
						<Text color={colors.secondary} italic>
							✓ AGENTS.md
						</Text>
					) : (
						<Text color={colors.secondary} italic>
							✗ No AGENTS.md
						</Text>
					)}
					{preferencesLoaded && (
						<Text color={colors.secondary}>✓ Preferences loaded</Text>
					)}
					{customCommandsCount !== undefined && customCommandsCount > 0 && (
						<Text color={colors.secondary}>
							✓ {customCommandsCount} custom commands
						</Text>
					)}
					{vscodeMode && vscodePort && (
						<Text color={showPortWarning ? colors.warning : colors.secondary}>
							{showPortWarning
								? `⚠ VS Code: port ${vscodeRequestedPort}→${vscodePort}`
								: `✓ VS Code: port ${vscodePort}`}
						</Text>
					)}
					{mcpTotal > 0 && (
						<Text
							color={
								mcpConnected === mcpTotal
									? colors.secondary
									: getStatusColor(mcpConnected, mcpTotal)
							}
						>
							{mcpConnected === mcpTotal ? '✓ ' : ''}MCP: {mcpConnected}/
							{mcpTotal} connected
						</Text>
					)}
					{lspTotal > 0 && (
						<Text
							color={
								lspConnected === lspTotal
									? colors.secondary
									: getStatusColor(lspConnected, lspTotal)
							}
						>
							{lspConnected === lspTotal ? '✓ ' : ''}LSP: {lspConnected}/
							{lspTotal} connected
						</Text>
					)}
					{contextUsage && contextUsage.contextLimit && (
						<Text color={colors.info}>
							<Text bold={true}>Context: </Text>
							{contextUsage.currentTokens.toLocaleString()}/
							{contextUsage.contextLimit.toLocaleString()} (
							{Math.round(contextUsage.percentUsed)}%)
						</Text>
					)}
					{autoCompactInfo && (
						<Text color={colors.secondary}>
							Auto-Compact: {autoCompactInfo.enabled ? '✓' : '✗'}
							{autoCompactInfo.hasOverrides && ' (override)'}
						</Text>
					)}
					{updateInfo?.hasUpdate && (
						<>
							<Text color={colors.warning}>
								⚠ v{updateInfo.currentVersion} → v{updateInfo.latestVersion}
							</Text>
							{updateInfo.updateCommand ? (
								<Text color={colors.secondary}>
									↳ Run: /update or {updateInfo.updateCommand}
								</Text>
							) : updateInfo.updateMessage ? (
								<Text color={colors.secondary}>{updateInfo.updateMessage}</Text>
							) : null}
						</>
					)}
				</Box>
			) : (
				/* Normal/Wide terminal: full layout with TitledBoxWithPreferences */
				<TitledBoxWithPreferences
					title="Status"
					width={boxWidth}
					borderColor={colors.info}
					paddingX={2}
					paddingY={1}
					flexDirection="column"
					marginBottom={1}
				>
					<Text color={colors.info}>
						<Text bold={true}>CWD: </Text>
						{truncatePath(cwd, maxPathLength)}
					</Text>
					<Text color={colors.info}>
						<Text bold={true}>Config: </Text>
						{truncatePath(confDirMap['agents.config.json'], maxPathLength)}
					</Text>
					<Text color={colors.success}>
						<Text bold={true}>Provider: </Text>
						{provider}, <Text bold={true}>Model: </Text>
						{model}
					</Text>
					<Text color={colors.primary}>
						<Text bold={true}>Theme: </Text>
						{themes[theme].displayName}
					</Text>
					{hasAgentsMd ? (
						<Text color={colors.secondary} italic>
							<Text>↳ Using AGENTS.md. Project initialized</Text>
						</Text>
					) : (
						<Text color={colors.secondary} italic>
							↳ No AGENTS.md file found, run `/init` to initialize this
							directory
						</Text>
					)}
					{preferencesLoaded && (
						<Text color={colors.secondary}>✓ Preferences loaded</Text>
					)}
					{customCommandsCount !== undefined && customCommandsCount > 0 && (
						<Text color={colors.secondary}>
							✓ {customCommandsCount} custom commands loaded
						</Text>
					)}
					{vscodeMode && vscodePort && (
						<Text color={showPortWarning ? colors.warning : colors.secondary}>
							{showPortWarning
								? `⚠ VS Code server on port ${vscodePort} (requested ${vscodeRequestedPort} was in use)`
								: `✓ VS Code server listening on port ${vscodePort}`}
						</Text>
					)}
					{mcpTotal > 0 && (
						<Box flexDirection="column">
							<Text
								color={
									mcpConnected === mcpTotal
										? colors.secondary
										: getStatusColor(mcpConnected, mcpTotal)
								}
							>
								{mcpConnected === mcpTotal ? '✓ ' : ''}MCP: {mcpConnected}/
								{mcpTotal} connected
							</Text>
							{mcpConnected < mcpTotal && (
								<Box flexDirection="column" marginLeft={2}>
									{mcpStatus
										.filter(s => s.status === 'failed')
										.map(server => (
											<Text key={server.name} color={colors.error}>
												• {server.name}:{' '}
												{server.errorMessage || 'Connection failed'}
											</Text>
										))}
								</Box>
							)}
						</Box>
					)}
					{lspTotal > 0 && (
						<Box flexDirection="column">
							<Text
								color={
									lspConnected === lspTotal
										? colors.secondary
										: getStatusColor(lspConnected, lspTotal)
								}
							>
								{lspConnected === lspTotal ? '✓ ' : ''}LSP: {lspConnected}/
								{lspTotal} connected
							</Text>
							{lspConnected < lspTotal && (
								<Box flexDirection="column" marginLeft={2}>
									{lspStatus
										.filter(s => s.status === 'failed')
										.map(server => (
											<Text key={server.name} color={colors.error}>
												• {server.name}:{' '}
												{server.errorMessage || 'Connection failed'}
											</Text>
										))}
								</Box>
							)}
						</Box>
					)}
					{contextUsage && contextUsage.contextLimit && (
						<Box flexDirection="column">
							<Text color={colors.info}>
								<Text bold={true}>Context: </Text>
								{contextUsage.currentTokens.toLocaleString()}/
								{contextUsage.contextLimit.toLocaleString()} tokens (
								{Math.round(contextUsage.percentUsed)}%)
							</Text>
							{contextUsage.percentUsed >= 60 && (
								<Text color={colors.warning} italic>
									↳ Consider using /compact to reduce context usage
								</Text>
							)}
						</Box>
					)}
					{autoCompactInfo && (
						<Box flexDirection="column">
							<Text color={colors.secondary}>
								<Text bold={true}>Auto-Compact: </Text>
								{autoCompactInfo.enabled ? '✓ enabled' : '✗ disabled'}
								{autoCompactInfo.hasOverrides && ' (session override)'}
							</Text>
							{autoCompactInfo.enabled && (
								<Text color={colors.secondary} italic>
									↳ Threshold: {autoCompactInfo.threshold}%, Mode:{' '}
									{autoCompactInfo.mode}
								</Text>
							)}
						</Box>
					)}
					{updateInfo?.hasUpdate && (
						<>
							<Text color={colors.warning}>
								<Text bold={true}>Update Available: </Text>v
								{updateInfo.currentVersion} → v{updateInfo.latestVersion}
							</Text>
							{updateInfo.updateCommand ? (
								<Text color={colors.secondary}>
									↳ Run: /update or {updateInfo.updateCommand}
								</Text>
							) : updateInfo.updateMessage ? (
								<Text color={colors.secondary}>{updateInfo.updateMessage}</Text>
							) : null}
						</>
					)}
				</TitledBoxWithPreferences>
			)}
		</>
	);
});
