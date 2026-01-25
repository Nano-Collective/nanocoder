import {Box, Text} from 'ink';
import React from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {getLSPManager} from '@/lsp/lsp-manager';
import type {Command} from '@/types/index';

interface LSPProps {
	status: {
		initialized: boolean;
		servers: Array<{name: string; ready: boolean; languages: string[]}>;
	};
}

export function LSP({status}: LSPProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const {servers} = status;

	return (
		<TitledBoxWithPreferences
			title="/lsp"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{servers.length === 0 ? (
				<>
					<Box marginBottom={1}>
						<Text color={colors.text} bold>
							No LSP servers connected
						</Text>
					</Box>

					<Text color={colors.text}>
						To connect LSP servers, configure them in your{' '}
						<Text color={colors.primary}>agents.config.json</Text> file:
					</Text>

					<Box marginTop={1} marginBottom={1}>
						<Text color={colors.secondary}>
							{`{
  "nanocoder": {
    "lsp": {
      "servers": [
        {
          "name": "typescript-language-server",
          "command": "typescript-language-server",
          "args": ["--stdio"],
          "languages": ["ts", "js", "tsx", "jsx"]
        }
      ]
    }
  }
}`}
						</Text>
					</Box>

					<Text color={colors.secondary}>
						LSP servers will auto-discover based on your project files.
					</Text>
				</>
			) : (
				<>
					<Box marginBottom={1}>
						<Text color={colors.primary}>
							Connected LSP Servers ({servers.length}):
						</Text>
					</Box>

					{servers.map((server, index) => {
						// Determine status icon and text based on readiness
						const statusIcon = server.ready ? '🟢' : '🔴';
						const statusText = server.ready ? 'Ready' : 'Initializing';

						return (
							<Box key={index} marginBottom={1}>
								<Box flexDirection="column">
									<Text color={colors.text}>
										• {statusIcon}{' '}
										<Text color={colors.primary}>{server.name}</Text>:{' '}
										<Text color={colors.secondary}>({statusText})</Text>
									</Text>

									{server.languages.length > 0 && (
										<Text color={colors.secondary}>
											Languages: {server.languages.join(', ')}
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

export const lspCommand: Command = {
	name: 'lsp',
	description: 'Show connected LSP servers and their status',
	handler: async (_args: string[], _messages, _metadata) => {
		const lspManager = await getLSPManager();

		// Get the current status of LSP servers
		const status = lspManager.getStatus();

		return React.createElement(LSP, {
			key: `lsp-${Date.now()}`,
			status: status,
		});
	},
};
