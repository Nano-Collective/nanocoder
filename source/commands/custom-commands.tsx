import {Box, Text} from 'ink';
import React from 'react';
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
							{`---\n`}
							{`Generate comprehensive unit tests for {{filename}}...`}
						</Text>
					</Box>
				</>
			) : (
				<>
					<Box marginBottom={1}>
						<Text color={colors.text}>
							Found {commands.length} custom command
							{commands.length !== 1 ? 's' : ''}:
						</Text>
					</Box>

					{sortedCommands.map((cmd, index) => (
						<Text key={index} color={colors.text}>
							• {formatCommand(cmd)}
						</Text>
					))}
				</>
			)}
		</TitledBoxWithPreferences>
	);
}

export const commandsCommand: Command = {
	name: 'custom-commands',
	description: 'List all custom commands from .nanocoder/commands',
	handler: (_args: string[]) => {
		// Create a custom command loader to get the commands
		const loader = new CustomCommandLoader();
		loader.loadCommands();
		const commands = loader.getAllCommands() || [];

		return Promise.resolve(
			React.createElement(CustomCommands, {
				key: `custom-commands-${Date.now()}`,
				commands: commands,
			}),
		);
	},
};
