import {Box, Text} from 'ink';
import React from 'react';
import {commandRegistry} from '@/commands';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {generateKey} from '@/session/key-generator';
import type {Command} from '@/types/index';
import {errorMsg} from '@/utils/message-factory';
import {getPackageVersion} from '@/utils/package-version';
import {
	findHelpCommand,
	getCommandHelpDetails,
	groupHelpCommands,
} from './help-utils';

let cachedVersion: string | null = null;

function getCachedPackageVersion(): string {
	cachedVersion ??= getPackageVersion();
	return cachedVersion;
}

function Help({
	version,
	commands,
	selectedCommand,
}: {
	version: string;
	commands: Command[];
	selectedCommand?: Command;
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
			<Text color={colors.text}>
				{' '}
				• Keyboard shortcuts {'>'} press ? in an empty prompt
			</Text>

			{selectedCommand ? (
				<CommandDetails command={selectedCommand} />
			) : (
				<CommandList commands={commands} />
			)}
		</TitledBoxWithPreferences>
	);
}

function CommandList({commands}: {commands: Command[]}) {
	const {colors} = useTheme();
	const groups = groupHelpCommands(commands);

	return (
		<Box flexDirection="column" marginTop={1}>
			{groups.length === 0 ? (
				<Text color={colors.text}> No commands available.</Text>
			) : (
				groups.map(group => (
					<Box key={group.category} flexDirection="column" marginBottom={1}>
						<Text color={colors.primary} bold>
							{group.category}:
						</Text>
						{group.commands.map(command => (
							<Text key={command.name} color={colors.text}>
								{' '}
								• /{command.name} - {command.description}
							</Text>
						))}
					</Box>
				))
			)}
		</Box>
	);
}

function CommandDetails({command}: {command: Command}) {
	const {colors} = useTheme();
	const details = getCommandHelpDetails(command);

	return (
		<Box flexDirection="column" marginTop={1}>
			<Text color={colors.primary} bold>
				Command: /{command.name}
			</Text>
			<Text color={colors.text}>{command.description}</Text>
			<Text color={colors.secondary}>Category: {details.category}</Text>
			<Text color={colors.secondary}>Usage: {details.usage}</Text>
			{details.aliases?.length ? (
				<Text color={colors.secondary}>
					Aliases: {details.aliases.map(alias => `/${alias}`).join(', ')}
				</Text>
			) : null}
			{details.options?.length ? (
				<Box flexDirection="column" marginTop={1}>
					<Text color={colors.primary} bold>
						Options & subcommands:
					</Text>
					{details.options.map(option => (
						<Text key={option} color={colors.text}>
							• {option}
						</Text>
					))}
				</Box>
			) : null}
			{details.examples?.length ? (
				<Box flexDirection="column" marginTop={1}>
					<Text color={colors.primary} bold>
						Examples:
					</Text>
					{details.examples.map(example => (
						<Text key={example} color={colors.text}>
							• {example}
						</Text>
					))}
				</Box>
			) : null}
		</Box>
	);
}

export const helpCommand: Command = {
	name: 'help',
	description: 'Show available commands',
	handler: async (args: string[], _messages, _metadata) => {
		const commands = commandRegistry.getAll();
		const version = getCachedPackageVersion();
		const requestedName = args[0];
		const selectedCommand = requestedName
			? findHelpCommand(commands, requestedName)
			: undefined;

		if (requestedName && !selectedCommand) {
			return errorMsg(
				`Unknown command: ${requestedName}. Type /help to see available commands.`,
				'help-error',
			);
		}

		return React.createElement(Help, {
			key: generateKey('help'),
			version,
			commands: commands,
			selectedCommand,
		});
	},
};
