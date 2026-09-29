import {Box, Text} from 'ink';
import React from 'react';
import {
	ICON_BULLET,
	ICON_MCP_HTTP,
	ICON_MCP_STDIO,
	ICON_MCP_UNKNOWN,
	ICON_MCP_WEBSOCKET,
} from '@/components/ui/icons';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {getToolManager} from '@/message-handler';
import {generateKey} from '@/session/key-generator';
import {ToolManager} from '@/tools/tool-manager';
import type {Command} from '@/types/index';

// Helper function to get transport icons. Uses the consistent icon
// vocabulary (ASCII brackets) rather than full-emoji glyphs so the
// symbols align cleanly across terminals — emoji transport icons were
// rendered as 2-column glyphs by string-width and broke MCP-list alignment.
function getTransportIcon(transportType: string): string {
	switch (transportType.toLowerCase()) {
		case 'stdio':
			return ICON_MCP_STDIO;
		case 'websocket':
		case 'ws':
			return ICON_MCP_WEBSOCKET;
		case 'http':
		case 'https':
		case 'sse':
			return ICON_MCP_HTTP;
		default:
			return ICON_MCP_UNKNOWN;
	}
}

interface MCPProps {
	toolManager: ToolManager | null;
}

export function MCP({toolManager}: MCPProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const connectedServers = toolManager?.getConnectedServers() || [];

	return (
		<TitledBoxWithPreferences
			title="Model Context Protocol Servers"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{connectedServers.length === 0 ? (
				<>
					<Box marginBottom={1}>
						<Text color={colors.text} bold>
							No MCP servers connected
						</Text>
					</Box>

					<Text color={colors.text}>
						To connect MCP servers, add them to your{' '}
						<Text color={colors.primary}>.mcp.json</Text> file:
					</Text>

					<Box marginTop={1} marginBottom={1}>
						<Text color={colors.secondary}>
							{`{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "description": "Project filesystem access",
      "alwaysAllow": ["list_directory", "file_info"]
    },
    "http-server": {
      "transport": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}`}
						</Text>
					</Box>

					<Text color={colors.secondary}>
						Use <Text color={colors.primary}>/settings mcp</Text> to configure
						servers interactively.
					</Text>
				</>
			) : (
				<>
					<Box marginBottom={1}>
						<Text color={colors.primary}>
							Connected MCP Servers ({connectedServers.length}):
						</Text>
					</Box>

					{connectedServers.map((serverName, index) => {
						const serverTools = toolManager?.getServerTools(serverName) || [];
						const serverInfo = toolManager?.getServerInfo(serverName);
						const transportIcon = getTransportIcon(
							serverInfo?.transport || 'stdio',
						);

						return (
							<Box key={index} marginBottom={1}>
								<Box flexDirection="column">
									<Text color={colors.text}>
										{ICON_BULLET} {transportIcon}{' '}
										<Text color={colors.primary}>{serverName}</Text>:{' '}
										<Text color={colors.secondary}>
											({serverInfo?.transport?.toUpperCase() || 'STDIO'})
										</Text>{' '}
										{ICON_BULLET} {serverTools.length} tool
										{serverTools.length !== 1 ? 's' : ''}
									</Text>

									{serverInfo?.url && (
										<Text color={colors.info}>URL: {serverInfo.url}</Text>
									)}

									{serverInfo?.description && (
										<Text color={colors.success}>{serverInfo.description}</Text>
									)}

									{/* {serverInfo?.tags && serverInfo.tags.length > 0 && (
										<Text color={colors.secondary}>
											Tags: {serverInfo.tags.map(tag => `#${tag}`).join(' ')}
										</Text>
									)} */}
									{!!serverInfo?.autoApprovedCommands?.length && (
										<Text color={colors.secondary}>
											Auto-approved tools:{' '}
											{serverInfo.autoApprovedCommands.join(', ')}
										</Text>
									)}
									{serverTools.length > 0 && (
										<Text color={colors.tool}>
											Tools:{' '}
											{serverTools
												.map((t: {name: string}) => t.name)
												.join(', ')}
										</Text>
									)}
								</Box>
							</Box>
						);
					})}
				</>
			)}
		</TitledBoxWithPreferences>
	);
}

export const mcpCommand: Command = {
	name: 'mcp',
	description: 'Show connected MCP servers and their tools',
	handler: (_args: string[], _messages, _metadata) => {
		const toolManager = getToolManager();

		return Promise.resolve(
			React.createElement(MCP, {
				key: generateKey('mcp'),
				toolManager: toolManager,
			}),
		);
	},
};
