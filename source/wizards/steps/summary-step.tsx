import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {colors} from '@/config/index';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import type {ProviderConfig} from '../../types/config';
import type {McpServerConfig} from '../templates/mcp-templates';

// Helper function to get transport icon
function getTransportIcon(transport: string): string {
	switch (transport) {
		case 'stdio':
			return '[STDIO]'; // Full name for stdio transport
		case 'http':
			return '[HTTP]'; // Full name for http transport
		case 'websocket':
			return '[WEBSOCKET]'; // Full name for websocket transport
		default:
			return '[UNKNOWN]'; // Unknown transport
	}
}

// Helper function to get connection details based on transport type
function getConnectionDetails(
	server: McpServerConfig,
): {label: string; value: string}[] {
	const details: {label: string; value: string}[] = [];

	// Always show transport type
	details.push({
		label: 'Transport',
		value: server.transport || 'unknown',
	});

	// Show connection details based on transport type
	if (server.transport === 'stdio') {
		const command = server.command || '';
		const args = server.args?.join(' ') || '';
		details.push({
			label: 'Cmd',
			value: `${command} ${args}`.trim(),
		});
	} else if (server.transport === 'http' || server.transport === 'websocket') {
		if (server.url) {
			details.push({
				label: server.transport === 'http' ? 'URL' : 'WS URL',
				value: server.url,
			});
		}

		// Show timeout for remote servers if specified
		if (server.timeout) {
			details.push({
				label: 'Timeout',
				value: `${server.timeout / 1000}s`,
			});
		}
	}

	// Show environment variables if present
	if (server.env && Object.keys(server.env).length > 0) {
		details.push({
			label: 'Env',
			value: Object.keys(server.env).join(', '),
		});
	}

	return details;
}

interface SummaryStepProps {
	providerConfigPath: string;
	mcpConfigPath: string;
	providers: ProviderConfig[];
	mcpServers: Record<string, McpServerConfig>;
	onSave: () => void;
	onAddProviders: () => void;
	onAddMcpServers: () => void;
	onCancel: () => void;
	onBack?: () => void;
}

export function SummaryStep({
	providerConfigPath,
	mcpConfigPath,
	providers,
	mcpServers,
	onSave,
	onAddProviders,
	onAddMcpServers,
	onCancel,
	onBack,
}: SummaryStepProps) {
	const {isNarrow, truncatePath} = useResponsiveTerminal();

	const options = [
		{label: 'Save configuration', value: 'save'},
		{label: 'Add more providers', value: 'add-providers'},
		{label: 'Add more MCP servers', value: 'add-mcp'},
		{label: 'Cancel (discard changes)', value: 'cancel'},
	];

	const handleSelect = (item: {value: string; label: string}) => {
		switch (item.value) {
			case 'save': {
				onSave();
				break;
			}
			case 'add-providers': {
				onAddProviders();
				break;
			}
			case 'add-mcp': {
				onAddMcpServers();
				break;
			}
			case 'cancel': {
				onCancel();
				break;
			}
		}
	};

	// Handle Shift+Tab to go back
	useInput((_input, key) => {
		if (key.shift && key.tab) {
			if (onBack) {
				onBack();
			}
		}
	});

	const serverNames = Object.keys(mcpServers);

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold color={colors.primary}>
					Configuration Summary
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text color={colors.secondary}>{'─'.repeat(isNarrow ? 30 : 60)}</Text>
			</Box>

			<Box marginBottom={1} flexDirection="column">
				<Text bold color={colors.primary}>
					Configuration files:
				</Text>
				<Text color={colors.success}>
					{isNarrow ? truncatePath(providerConfigPath, 40) : providerConfigPath}
				</Text>
				<Text color={colors.success}>
					{isNarrow ? truncatePath(mcpConfigPath, 40) : mcpConfigPath}
				</Text>
			</Box>

			<Box marginBottom={1} flexDirection="column">
				<Text bold color={colors.primary}>
					Providers ({providers.length}):
				</Text>
				{providers.length === 0 ? (
					<Text color={colors.warning}> None</Text>
				) : (
					providers.map((provider, index) => (
						<Box key={index} flexDirection="column" marginLeft={2}>
							<Text>
								• <Text color={colors.success}>{provider.name}</Text>
							</Text>
							{!isNarrow && provider.baseUrl && (
								<Text dimColor> URL: {provider.baseUrl}</Text>
							)}
							{!isNarrow && (
								<Text dimColor>
									Models: {provider.models?.join(', ') || 'none'}
								</Text>
							)}
						</Box>
					))
				)}
			</Box>

			<Box marginBottom={1} flexDirection="column">
				<Text bold color={colors.primary}>
					MCP Servers ({serverNames.length}):
				</Text>
				{serverNames.length === 0 ? (
					<Text color={colors.warning}> None</Text>
				) : (
					serverNames.map(name => {
						const server = mcpServers[name];
						const transportIcon = getTransportIcon(
							server.transport || 'unknown',
						);
						const connectionDetails = getConnectionDetails(server);

						return (
							<Box key={name} flexDirection="column" marginLeft={2}>
								<Text>
									• <Text color={colors.success}>{server.name}</Text>{' '}
									{transportIcon}
								</Text>
								{!isNarrow && (
									<>
										{connectionDetails.map((detail, index) => (
											<Text key={index} dimColor>
												{detail.label}: {detail.value}
											</Text>
										))}
									</>
								)}
							</Box>
						);
					})
				)}
			</Box>

			<Box marginBottom={1}>
				<Text color={colors.secondary}>{'─'.repeat(isNarrow ? 30 : 60)}</Text>
			</Box>

			{providers.length === 0 && (
				<Box marginBottom={1}>
					<Text color={colors.warning}>
						! {isNarrow ? 'No providers!' : 'Warning: No providers configured.'}
					</Text>
				</Box>
			)}

			<SelectInput items={options} onSelect={handleSelect} />
		</Box>
	);
}
