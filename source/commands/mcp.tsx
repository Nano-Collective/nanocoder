import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import React, {useEffect, useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {getToolManager} from '@/message-handler';
import {generateKey} from '@/session/key-generator';
import {ToolManager} from '@/tools/tool-manager';
import type {Command} from '@/types/index';
import {formatError} from '@/utils/error-formatter';

// Helper function to get transport icons
function getTransportIcon(transportType: string): string {
	switch (transportType.toLowerCase()) {
		case 'stdio':
			return '💻';
		case 'websocket':
			return '🔄';
		case 'http':
			return '🌐';
		default:
			return '❓';
	}
}

interface MCPProps {
	toolManager: ToolManager | null;
}

export function MCP({toolManager}: MCPProps) {
	const [, refresh] = useState(0);
	useEffect(() => {
		if (!toolManager?.onMCPHealthChange) return;
		return toolManager.onMCPHealthChange(() => refresh(value => value + 1));
	}, [toolManager]);
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const connectedServers =
		(toolManager?.getServerNames?.() ?? toolManager?.getConnectedServers()) ||
		[];
	const authRequiredServers = toolManager?.getAuthRequiredMCPServers?.() || [];

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
			{connectedServers.length === 0 && authRequiredServers.length === 0 ? (
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
					{connectedServers.length > 0 && (
						<Box marginBottom={1}>
							<Text color={colors.primary}>
								{connectedServers.every(
									serverName =>
										toolManager?.getServerInfo(serverName)?.connected,
								)
									? 'Connected MCP Servers'
									: 'MCP Servers'}{' '}
								({connectedServers.length}):
							</Text>
						</Box>
					)}

					{connectedServers.map((serverName, index) => {
						const serverTools = toolManager?.getServerTools(serverName) || [];
						const mcpClient = toolManager?.getMCPClient?.();
						const serverResources =
							mcpClient?.getServerResources(serverName) || [];
						const serverPrompts = mcpClient?.getServerPrompts(serverName) || [];
						const serverInfo = toolManager?.getServerInfo(serverName);
						const transportIcon = getTransportIcon(
							serverInfo?.transport || 'stdio',
						);

						return (
							<Box key={index} marginBottom={1}>
								<Box flexDirection="column">
									<Text color={colors.text}>
										• {transportIcon}{' '}
										<Text color={colors.primary}>{serverName}</Text>:{' '}
										<Text color={colors.secondary}>
											({serverInfo?.transport?.toUpperCase() || 'STDIO'})
										</Text>{' '}
										{serverInfo?.connected ? '• healthy' : '• unhealthy'} •{' '}
										{serverTools.length} tool
										{serverTools.length !== 1 ? 's' : ''}
										{serverResources.length > 0 &&
											`, ${serverResources.length} resource${serverResources.length !== 1 ? 's' : ''}`}
										{serverPrompts.length > 0 &&
											`, ${serverPrompts.length} prompt${serverPrompts.length !== 1 ? 's' : ''}`}
									</Text>

									{serverInfo?.url && (
										<Text color={colors.info}>URL: {serverInfo.url}</Text>
									)}

									{serverInfo?.description && (
										<Text color={colors.success}>{serverInfo.description}</Text>
									)}

									{!!serverInfo?.tags?.length && (
										<Text color={colors.secondary}>
											Tags: {serverInfo.tags.map(tag => `#${tag}`).join(' ')}
										</Text>
									)}
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
									{serverResources.length > 0 && (
										<Text color={colors.tool}>
											Resources: {serverResources.map(r => r.name).join(', ')}
										</Text>
									)}
									{serverPrompts.length > 0 && (
										<Text color={colors.tool}>
											Prompts:{' '}
											{serverPrompts
												.map(p => `/mcp:${serverName}:${p.name}`)
												.join(', ')}
										</Text>
									)}
								</Box>
							</Box>
						);
					})}

					{authRequiredServers.length > 0 && (
						<Box flexDirection="column" marginBottom={1}>
							<Text color={colors.warning}>
								Authentication required ({authRequiredServers.length}):
							</Text>
							{authRequiredServers.map(serverName => (
								<Text key={serverName} color={colors.text}>
									• 🌐 <Text color={colors.primary}>{serverName}</Text>: sign in
									with{' '}
									<Text color={colors.primary}>/mcp login {serverName}</Text>
								</Text>
							))}
						</Box>
					)}
				</>
			)}
		</TitledBoxWithPreferences>
	);
}

// ---------------------------------------------------------------------------
// /mcp login <server> and /mcp logout <server>
// ---------------------------------------------------------------------------

type LoginStatus = 'starting' | 'visit' | 'done' | 'error';

interface LoginState {
	status: LoginStatus;
	authorizationUrl?: string;
	error?: string;
}

/**
 * Runs the OAuth login once and lets any number of mounted components observe
 * it. The flow is started from the command handler, outside React, so a
 * re-render or re-mount of the message list cannot start a second browser
 * flow or a second loopback listener.
 */
export class MCPLoginFlow {
	private state: LoginState = {status: 'starting'};
	private listeners = new Set<(state: LoginState) => void>();

	constructor(
		readonly serverName: string,
		run: (onAuthorizationUrl: (url: URL) => void) => Promise<void>,
	) {
		run(url => {
			this.update({status: 'visit', authorizationUrl: url.toString()});
		})
			.then(() => this.update({status: 'done'}))
			.catch((error: unknown) =>
				this.update({status: 'error', error: formatError(error)}),
			);
	}

	getState(): LoginState {
		return this.state;
	}

	subscribe(listener: (state: LoginState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private update(patch: Partial<LoginState>): void {
		this.state = {...this.state, ...patch};
		for (const listener of this.listeners) listener(this.state);
	}
}

interface MCPLoginProps {
	flow: MCPLoginFlow;
}

export function MCPLogin({flow}: MCPLoginProps) {
	const [state, setState] = useState<LoginState>(flow.getState());
	useEffect(() => flow.subscribe(setState), [flow]);
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	return (
		<TitledBoxWithPreferences
			title={`MCP Login: ${flow.serverName}`}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{state.status === 'starting' && (
				<Text color={colors.text}>
					<Spinner type="dots" /> Contacting the authorization server…
				</Text>
			)}
			{state.status === 'visit' && (
				<Box flexDirection="column">
					<Text color={colors.text}>
						Opening your browser to sign in. If it did not open, visit:
					</Text>
					<Box marginTop={1} marginBottom={1}>
						<Text color={colors.primary}>{state.authorizationUrl}</Text>
					</Box>
					<Text color={colors.secondary}>
						<Spinner type="dots" /> Waiting for the sign-in to finish…
					</Text>
				</Box>
			)}
			{state.status === 'done' && (
				<Text color={colors.success}>
					✓ Signed in to {flow.serverName}. Its tools are now available; run{' '}
					<Text color={colors.primary}>/mcp</Text> to see them.
				</Text>
			)}
			{state.status === 'error' && (
				<Box flexDirection="column">
					<Text color={colors.error}>✗ Login failed: {state.error}</Text>
					<Text color={colors.secondary}>
						Check the server URL in your config and try{' '}
						<Text color={colors.primary}>/mcp login {flow.serverName}</Text>{' '}
						again.
					</Text>
				</Box>
			)}
		</TitledBoxWithPreferences>
	);
}

interface MCPNoticeProps {
	title: string;
	message: string;
	tone: 'success' | 'error';
}

function MCPNotice({title, message, tone}: MCPNoticeProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	return (
		<TitledBoxWithPreferences
			title={title}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Text color={tone === 'success' ? colors.success : colors.error}>
				{message}
			</Text>
		</TitledBoxWithPreferences>
	);
}

const USAGE =
	'Usage: /mcp, /mcp login <server> or /mcp logout <server>. Login and logout apply to http servers that use OAuth.';

/**
 * Resolve `/mcp` arguments into the element to render. Exported for tests;
 * the command handler wires it to the live ToolManager.
 */
export async function handleMcpArgs(
	args: string[],
	toolManager: ToolManager | null,
): Promise<React.ReactElement> {
	const [subcommand, serverName, ...rest] = args.map(arg => arg.trim());

	if (!subcommand) {
		return React.createElement(MCP, {key: generateKey('mcp'), toolManager});
	}

	if (
		(subcommand !== 'login' && subcommand !== 'logout') ||
		!serverName ||
		rest.length > 0
	) {
		return React.createElement(MCPNotice, {
			key: generateKey('mcp'),
			title: 'Model Context Protocol Servers',
			tone: 'error',
			message: USAGE,
		});
	}

	if (!toolManager) {
		return React.createElement(MCPNotice, {
			key: generateKey('mcp'),
			title: `MCP ${subcommand === 'login' ? 'Login' : 'Logout'}: ${serverName}`,
			tone: 'error',
			message: 'MCP is not initialized yet; try again in a moment.',
		});
	}

	if (subcommand === 'login') {
		const flow = new MCPLoginFlow(serverName, onAuthorizationUrl =>
			toolManager.loginToMCPServer(serverName, onAuthorizationUrl),
		);
		return React.createElement(MCPLogin, {key: generateKey('mcp'), flow});
	}

	try {
		await toolManager.logoutFromMCPServer(serverName);
		return React.createElement(MCPNotice, {
			key: generateKey('mcp'),
			title: `MCP Logout: ${serverName}`,
			tone: 'success',
			message: `✓ Signed out of ${serverName}. Stored OAuth tokens were removed; run /mcp login ${serverName} to sign in again.`,
		});
	} catch (error) {
		return React.createElement(MCPNotice, {
			key: generateKey('mcp'),
			title: `MCP Logout: ${serverName}`,
			tone: 'error',
			message: `✗ Logout failed: ${formatError(error)}`,
		});
	}
}

export const mcpCommand: Command = {
	name: 'mcp',
	description:
		'Show connected MCP servers and their tools; "login"/"logout <server>" for OAuth servers',
	handler: (args: string[], _messages, _metadata) =>
		handleMcpArgs(args, getToolManager()),
};
