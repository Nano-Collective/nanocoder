import {Box, Text} from 'ink';
import React from 'react';
import {InfoMessage} from '@/components/message-box';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {useTheme} from '@/hooks/useTheme';
import type {Command, CustomCommand} from '@/types/index';

interface CustomCommandsProps {
	commands: CustomCommand[];
}

function formatCommand(cmd: CustomCommand): string {
	const parts: string[] = [`/${cmd.fullName}`];

	if (cmd.metadata.parameters && cmd.metadata.parameters.length > 0) {
		parts.push(cmd.metadata.parameters.map((p: string) => `<${p}>`).join(' '));
	}

	if (cmd.metadata.description) {
		parts.push(`- ${cmd.metadata.description}`);
	}

	if (cmd.metadata.aliases && cmd.metadata.aliases.length > 0) {
		const aliasNames = cmd.metadata.aliases.map((a: string) =>
			cmd.namespace ? `${cmd.namespace}:${a}` : a,
		);
		parts.push(`(aliases: ${aliasNames.join(', ')})`);
	}

	return parts.join(' ');
}

function CustomCommands({commands}: CustomCommandsProps) {
	const {colors} = useTheme();
	// Sort commands alphabetically by full name
	const sortedCommands = [...commands].sort((a, b) =>
		a.fullName.localeCompare(b.fullName),
	);

	// Separate auto-injectable commands (with triggers/tags) from manual-only
	const autoInjectable = sortedCommands.filter(
		cmd => cmd.metadata.triggers?.length || cmd.metadata.tags?.length,
	);
	const manualOnly = sortedCommands.filter(
		cmd => !cmd.metadata.triggers?.length && !cmd.metadata.tags?.length,
	);

	return (
		<TitledBoxWithPreferences
			title="Custom Commands"
			width={75}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{commands.length === 0 ? (
				<>
					<Box marginBottom={1}>
						<Text color={colors.text} bold>
							No custom commands found
						</Text>
					</Box>

					<Text color={colors.text}>To create custom commands:</Text>

					<Text color={colors.secondary}>
						1. Create a <Text color={colors.primary}>.nanocoder/commands</Text>{' '}
						directory in your project
					</Text>

					<Text color={colors.secondary}>
						2. Add <Text color={colors.primary}>.md</Text> files with command
						prompts
					</Text>

					<Text color={colors.secondary}>
						3. Optionally add frontmatter for metadata:
					</Text>

					<Box marginTop={1} marginBottom={1}>
						<Text color={colors.secondary}>
							{`---\n`}
							{`description: Generate unit tests\n`}
							{`aliases: [test, unittest]\n`}
							{`parameters: [filename]\n`}
							{`tags: [testing, quality]\n`}
							{`triggers: [write tests, unit test]\n`}
							{`---\n`}
							{`Generate comprehensive unit tests for {{filename}}...`}
						</Text>
					</Box>
				</>
			) : (
				<>
					{manualOnly.length > 0 && (
						<>
							<Box marginBottom={1}>
								<Text color={colors.text}>
									Found {manualOnly.length} custom command
									{manualOnly.length !== 1 ? 's' : ''}:
								</Text>
							</Box>

							{manualOnly.map((cmd, index) => (
								<Text key={index} color={colors.text}>
									• {formatCommand(cmd)}
								</Text>
							))}
						</>
					)}

					{autoInjectable.length > 0 && (
						<>
							{manualOnly.length > 0 && <Box marginTop={1} />}
							<Box marginBottom={1}>
								<Text color={colors.text} bold>
									Auto-injectable ({autoInjectable.length}):
								</Text>
							</Box>

							{autoInjectable.map((cmd, index) => {
								const tokenEst = cmd.metadata.estimatedTokens
									? ` (~${cmd.metadata.estimatedTokens} tokens)`
									: '';
								return (
									<Box key={index} flexDirection="column">
										<Text color={colors.text}>
											• {formatCommand(cmd)}
											{tokenEst}
										</Text>
										{cmd.metadata.tags?.length && (
											<Text color={colors.secondary}>
												{'    '}Tags:{' '}
												{cmd.metadata.tags
													.map((t: string) => `\`${t}\``)
													.join(', ')}
											</Text>
										)}
									</Box>
								);
							})}
						</>
					)}
				</>
			)}
		</TitledBoxWithPreferences>
	);
}

function showCommandDetails(command: CustomCommand): React.ReactElement {
	let output = `${command.fullName}\n`;
	if (command.metadata.category)
		output += `Category: ${command.metadata.category}  `;
	if (command.metadata.version)
		output += `Version: ${command.metadata.version}  `;
	if (command.metadata.author) output += `Author: ${command.metadata.author}`;
	output += '\n';
	output += `Source: ${command.source ?? 'project'} (${command.path})\n\n`;
	if (command.metadata.description) {
		output += `${command.metadata.description}\n\n`;
	}
	if (command.metadata.examples?.length) {
		output += 'Examples:\n';
		for (const ex of command.metadata.examples) {
			output += `  - ${ex}\n`;
		}
		output += '\n';
	}
	if (command.loadedResources?.length) {
		output += 'Resources:\n';
		for (const r of command.loadedResources) {
			output += `  • ${r.name} (${r.type})${r.executable ? ' [executable]' : ''}\n`;
		}
		output += '\n';
	}
	if (command.metadata.references?.length) {
		output += `References: ${command.metadata.references.join(', ')}\n\n`;
	}
	if (command.lastModified) {
		output += `Last modified: ${command.lastModified.toLocaleDateString()}`;
	}

	return React.createElement(InfoMessage, {
		key: `commands-show-${Date.now()}`,
		message: output,
		hideBox: true,
	});
}

export const commandsCommand: Command = {
	name: 'custom-commands',
	description:
		'List all custom commands. Subcommands: show <name>, refresh, create <name>',
	handler: (args: string[]) => {
		const loader = new CustomCommandLoader();
		loader.loadCommands();

		const sub = args[0];

		if (sub === 'show') {
			const name = args[1] ?? '';
			if (!name) {
				return Promise.resolve(
					React.createElement(InfoMessage, {
						key: `commands-${Date.now()}`,
						message: 'Usage: /commands show <command-name>',
						hideBox: true,
					}),
				);
			}
			const command = loader.getCommand(name);
			if (!command) {
				return Promise.resolve(
					React.createElement(InfoMessage, {
						key: `commands-${Date.now()}`,
						message: `Command "${name}" not found. Use /commands to list available commands.`,
						hideBox: true,
					}),
				);
			}
			return Promise.resolve(showCommandDetails(command));
		}

		if (sub === 'refresh') {
			loader.loadCommands();
			return Promise.resolve(
				React.createElement(InfoMessage, {
					key: `commands-${Date.now()}`,
					message: 'Commands cache refreshed.',
					hideBox: true,
				}),
			);
		}

		if (sub === 'create') {
			return Promise.resolve(
				React.createElement(InfoMessage, {
					key: `commands-${Date.now()}`,
					message:
						'Usage: /commands create <name>\nExample: /commands create review-code\n\nThis creates a new command file and starts an AI-assisted session to write its content.',
					hideBox: true,
				}),
			);
		}

		const commands = loader.getAllCommands() || [];

		return Promise.resolve(
			React.createElement(CustomCommands, {
				key: `custom-commands-${Date.now()}`,
				commands: commands,
			}),
		);
	},
};
