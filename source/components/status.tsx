import {Box, Text} from 'ink';
import {memo} from 'react';
import {existsSync} from 'fs';

import {TitledBox, titleStyles} from '@mishieck/ink-titled-box';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {confDirMap} from '@/config/index';
import {themes, getThemeColors} from '@/config/themes';
import type {ThemePreset} from '@/types/ui';
import type {UpdateInfo} from '@/types/utils';
import type {MCPConnectionStatus} from '@/types/mcp';
import type {LSPConnectionStatus} from '@/lsp/lsp-manager';

// Get CWD once at module load time
const cwd = process.cwd();

// Using UpdateInfo from '@/types/utils' for type consistency

export default memo(
	function Status({
		provider,
		model,
		theme,
		updateInfo,
		agentsMdLoaded,
		mcpConnectionStatus,
		lspConnectionStatus,
	}: {
		provider: string;
		model: string;
		theme: ThemePreset;
		updateInfo?: UpdateInfo | null;
		agentsMdLoaded?: boolean;
		mcpConnectionStatus?: MCPConnectionStatus;
		lspConnectionStatus?: LSPConnectionStatus;
	}) {
		const {boxWidth, isNarrow, truncatePath} = useResponsiveTerminal();
		const colors = getThemeColors(theme);

		// Check for AGENTS.md synchronously if not provided
		const hasAgentsMd = agentsMdLoaded ?? existsSync(`${cwd}/AGENTS.md`);

		// Calculate max path length based on terminal size
		const maxPathLength = isNarrow ? 30 : 60;

		// Helper function to format MCP status
		const formatMCPStatus = (status: MCPConnectionStatus | undefined) => {
			if (!status) return '';
			if (status.totalCount === 0) return 'No servers configured';
			if (status.errorCount > 0) {
				return `${status.connectedCount} connected, ${status.errorCount} errors`;
			}
			return `${status.connectedCount} servers connected`;
		};

		// Helper function to format LSP status
		const formatLSPStatus = (status: LSPConnectionStatus | undefined) => {
			if (!status) return '';
			if (status.totalCount === 0 && status.connectedCount === 0)
				return 'No servers configured';
			if (status.errorCount > 0) {
				return `${status.connectedCount} ready, ${status.errorCount} errors`;
			}
			// During auto-discovery, show connected count even if total count is still being determined
			if (status.totalCount === 0 && status.connectedCount > 0) {
				return `${status.connectedCount} servers ready...`;
			}
			return `${status.connectedCount} servers ready`;
		};

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
						{mcpConnectionStatus && (
							<Text
								color={
									mcpConnectionStatus.errorCount > 0
										? colors.warning
										: colors.success
								}
							>
								<Text bold={true}>MCP: </Text>
								{formatMCPStatus(mcpConnectionStatus)}
							</Text>
						)}
						{lspConnectionStatus && (
							<Text
								color={
									lspConnectionStatus.errorCount > 0
										? colors.warning
										: colors.success
								}
							>
								<Text bold={true}>LSP: </Text>
								{formatLSPStatus(lspConnectionStatus)}
							</Text>
						)}
						{hasAgentsMd ? (
							<Text color={colors.secondary} italic>
								✓ AGENTS.md
							</Text>
						) : (
							<Text color={colors.secondary} italic>
								✗ No AGENTS.md
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
									<Text color={colors.secondary}>
										{updateInfo.updateMessage}
									</Text>
								) : null}
							</>
						)}
					</Box>
				) : (
					/* Normal/Wide terminal: full layout with TitledBox */
					<TitledBox
						key={colors.primary}
						borderStyle="round"
						titles={['Status']}
						titleStyles={titleStyles.pill}
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
						{mcpConnectionStatus && (
							<Text
								color={
									mcpConnectionStatus.errorCount > 0
										? colors.warning
										: colors.success
								}
							>
								<Text bold={true}>MCP: </Text>
								{formatMCPStatus(mcpConnectionStatus)}
							</Text>
						)}
						{lspConnectionStatus && (
							<Text
								color={
									lspConnectionStatus.errorCount > 0
										? colors.warning
										: colors.success
								}
							>
								<Text bold={true}>LSP: </Text>
								{formatLSPStatus(lspConnectionStatus)}
							</Text>
						)}
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
									<Text color={colors.secondary}>
										{updateInfo.updateMessage}
									</Text>
								) : null}
							</>
						)}
					</TitledBox>
				)}
			</>
		);
	},
	(prevProps, nextProps) => {
		// Custom comparison function to ensure re-renders when connection status changes
		return (
			prevProps.provider === nextProps.provider &&
			prevProps.model === nextProps.model &&
			prevProps.theme === nextProps.theme &&
			prevProps.agentsMdLoaded === nextProps.agentsMdLoaded &&
			prevProps.updateInfo?.hasUpdate === nextProps.updateInfo?.hasUpdate &&
			prevProps.updateInfo?.currentVersion ===
				nextProps.updateInfo?.currentVersion &&
			prevProps.updateInfo?.latestVersion ===
				nextProps.updateInfo?.latestVersion &&
			// Deep comparison for connection status objects
			JSON.stringify(prevProps.mcpConnectionStatus) ===
				JSON.stringify(nextProps.mcpConnectionStatus) &&
			JSON.stringify(prevProps.lspConnectionStatus) ===
				JSON.stringify(nextProps.lspConnectionStatus)
		);
	},
);
