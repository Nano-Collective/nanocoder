import {Box, Text} from 'ink';
import React from 'react';
import {commandRegistry} from '@/commands';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {generateKey} from '@/session/key-generator';
import {Command} from '@/types/index';
import {getPackageVersion} from '@/utils/package-version';

let cachedVersion: string | null = null;

function getCachedPackageVersion(): string {
	cachedVersion ??= getPackageVersion();
	return cachedVersion;
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
			<Text color={colors.text}> • Resume sessions {'>'} /resume</Text>

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
		const version = getCachedPackageVersion();

		return React.createElement(Help, {
			key: generateKey('help'),
			version,
			commands: commands,
		});
	},
};
