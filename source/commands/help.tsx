import {readFile} from 'node:fs/promises';
import {Box, Text} from 'ink';
import path from 'path';
import React from 'react';
import {fileURLToPath} from 'url';
import {commandRegistry} from '@/commands';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {Command} from '@/types/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let cachedVersion: string | null = null;

async function getPackageVersion(): Promise<string> {
	if (cachedVersion) {
		return cachedVersion;
	}

	try {
		const content = await readFile(
			path.join(__dirname, '../../package.json'),
			'utf8',
		);
		const packageJson = JSON.parse(content) as {version?: string};
		cachedVersion = packageJson.version ?? '0.0.0';
		return cachedVersion;
	} catch (error) {
		console.warn('Failed to read package version:', error);
		cachedVersion = '0.0.0';
		return cachedVersion;
	}
}

function Help({
	version,
	commands,
}: {
	version: string;
	commands: Array<{name: string; description: string}>;
}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	return (
		<TitledBoxWithPreferences
			title="Help"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			<Box marginBottom={1}>
				<Text color={colors.primary} bold>
					Nanocoder – {version}
				</Text>
			</Box>

			<Text color={colors.text}>
				A local-first CLI coding agent that brings the power of agentic coding
				tools like Claude Code and Gemini CLI to local models or controlled APIs
				like OpenRouter.
			</Text>

			<Box marginTop={1}>
				<Text color={colors.secondary}>
					Always review model responses, especially when running code. Models
					have read access to files in the current directory and can run
					commands and edit files with your permission.
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text color={colors.primary} bold>
					Common Tasks:
				</Text>
			</Box>
			<Text color={colors.text}>
				{' '}
				• Ask questions about your codebase {'>'} How does foo.py work?
			</Text>
			<Text color={colors.text}> • Edit files {'>'} Update bar.ts to...</Text>
			<Text color={colors.text}> • Fix errors {'>'} cargo build</Text>
			<Text color={colors.text}> • Run commands {'>'} /help</Text>

			<Box marginTop={1}>
				<Text color={colors.primary} bold>
					Commands:
				</Text>
			</Box>
			{commands.length === 0 ? (
				<Text color={colors.text}> No commands available.</Text>
			) : (
				commands.map((cmd, index) => (
					<Text key={index} color={colors.text}>
						{' '}
						• /{cmd.name} - {cmd.description}
					</Text>
				))
			)}
		</TitledBoxWithPreferences>
	);
}

export const helpCommand: Command = {
	name: 'help',
	description: 'Show available commands',
	handler: async (_args: string[], _messages, _metadata) => {
		const commands = commandRegistry.getAll();
		const version = await getPackageVersion();

		return React.createElement(Help, {
			key: `help-${Date.now()}`,
			version,
			commands: commands,
		});
	},
};
