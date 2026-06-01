import {Box, Text} from 'ink';
import React from 'react';
import {InfoField} from '@/components/ui/info-field';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {CustomCommandLoader} from '@/custom-commands/loader';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {getCommandLoader} from '@/message-handler';
import {generateKey} from '@/session/key-generator';
import type {Command, CustomCommand} from '@/types/index';
import {infoMsg} from '@/utils/message-factory';

interface CustomCommandsProps {
	commands: CustomCommand[];
}

/** Build the `/name <param> ...` invocation string. Used for the top row
 * of each command entry. Description and aliases now render on their own
 * indented secondary lines for visual consistency with `/agents`. */
function formatCommandHeader(cmd: CustomCommand): string {
	const parts: string[] = [`/${cmd.fullName}`];
	if (cmd.metadata.parameters && cmd.metadata.parameters.length > 0) {
		parts.push(cmd.metadata.parameters.map((p: string) => `<${p}>`).join(' '));
	}
	return parts.join(' ');
}

function aliasesLine(cmd: CustomCommand): string | null {
	if (!cmd.metadata.aliases || cmd.metadata.aliases.length === 0) return null;
	const names = cmd.metadata.aliases.map((a: string) =>
		cmd.namespace ? `${cmd.namespace}:${a}` : a,
	);
	return `aliases: ${names.join(', ')}`;
}

/** Single command entry. Matches the visual shape of `/agents` list rows:
 * bold `› /name` + secondary meta on the header line, then indented
 * description and any auxiliary lines (aliases, tags, token estimate). */
function CommandEntry({cmd, isLast}: {cmd: CustomCommand; isLast: boolean}) {
	const {colors} = useTheme();
	const aliases = aliasesLine(cmd);
	const tokenEst = cmd.metadata.estimatedTokens
		? `~${cmd.metadata.estimatedTokens} tokens`
		: null;
	const tags = cmd.metadata.tags?.length
		? `tags: ${cmd.metadata.tags.map((t: string) => `\`${t}\``).join(', ')}`
		: null;
	return (
		<Box flexDirection="column" marginBottom={isLast ? 0 : 1}>
			<Box>
				<Text color={colors.text} bold>
					› {formatCommandHeader(cmd)}
				</Text>
				{tokenEst && <Text color={colors.secondary}> · {tokenEst}</Text>}
			</Box>
			{cmd.metadata.description && (
				<Box marginLeft={4}>
					<Text color={colors.secondary}>{cmd.metadata.description}</Text>
				</Box>
			)}
			{aliases && (
				<Box marginLeft={4}>
					<Text color={colors.secondary}>{aliases}</Text>
				</Box>
			)}
			{tags && (
				<Box marginLeft={4}>
					<Text color={colors.secondary}>{tags}</Text>
				</Box>
			)}
		</Box>
	);
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
								<Text color={colors.primary} bold>
									Manual ({manualOnly.length})
								</Text>
							</Box>

							{manualOnly.map((cmd, i) => (
								<CommandEntry
									key={cmd.fullName}
									cmd={cmd}
									isLast={i === manualOnly.length - 1}
								/>
							))}
						</>
					)}

					{autoInjectable.length > 0 && (
						<>
							{manualOnly.length > 0 && <Box marginTop={1} />}
							<Box marginBottom={1}>
								<Text color={colors.primary} bold>
									Auto-injectable ({autoInjectable.length})
								</Text>
							</Box>

							{autoInjectable.map((cmd, i) => (
								<CommandEntry
									key={cmd.fullName}
									cmd={cmd}
									isLast={i === autoInjectable.length - 1}
								/>
							))}
						</>
					)}
				</>
			)}
		</TitledBoxWithPreferences>
	);
}

function CommandDetail({command}: {command: CustomCommand}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	const sourceLabel = command.path
		? `${command.source ?? 'project'} (${command.path})`
		: (command.source ?? 'project');

	const fields: Array<{label: string; value: string}> = [
		{label: 'Source', value: sourceLabel},
		...(command.metadata.category
			? [{label: 'Category', value: command.metadata.category}]
			: []),
		...(command.metadata.version
			? [{label: 'Version', value: command.metadata.version}]
			: []),
		...(command.metadata.author
			? [{label: 'Author', value: command.metadata.author}]
			: []),
		...(command.metadata.references?.length
			? [
					{
						label: 'References',
						value: command.metadata.references.join(', '),
					},
				]
			: []),
		...(command.lastModified
			? [
					{
						label: 'Last modified',
						value: command.lastModified.toLocaleDateString(),
					},
				]
			: []),
	];

	return (
		<TitledBoxWithPreferences
			title={`Command: /${command.fullName}`}
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{command.metadata.description && (
				<Box marginBottom={1}>
					<Text>{command.metadata.description}</Text>
				</Box>
			)}

			{fields.map(f => (
				<InfoField key={f.label} label={f.label} value={f.value} />
			))}

			{command.metadata.examples?.length ? (
				<Box flexDirection="column" marginBottom={1}>
					<Text color={colors.primary} bold>
						Examples
					</Text>
					{command.metadata.examples.map((ex, i) => (
						<Text key={i} color={colors.secondary}>
							› {ex}
						</Text>
					))}
				</Box>
			) : null}

			{command.loadedResources?.length ? (
				<Box flexDirection="column" marginBottom={1}>
					<Text color={colors.primary} bold>
						Resources
					</Text>
					{command.loadedResources.map((r, i) => (
						<Text key={i} color={colors.secondary}>
							› {r.name} ({r.type}){r.executable ? ' [executable]' : ''}
						</Text>
					))}
				</Box>
			) : null}
		</TitledBoxWithPreferences>
	);
}

export const commandsCommand: Command = {
	name: 'custom-commands',
	description: 'List custom commands. Subcommands: show <name>, create <name>',
	handler: (args: string[]) => {
		// Prefer the app's shared loader so bundle-registered commands are
		// visible. Fall back to a fresh disk-scan instance only if no app
		// loader is registered (e.g. ad-hoc invocations from tests).
		const shared = getCommandLoader();
		const loader = shared ?? new CustomCommandLoader();
		if (!shared) loader.loadCommands();

		const sub = args[0];

		if (sub === 'show') {
			const name = args[1] ?? '';
			if (!name) {
				return Promise.resolve(
					infoMsg('Usage: /commands show <command-name>', 'commands'),
				);
			}
			const command = loader.getCommand(name);
			if (!command) {
				return Promise.resolve(
					infoMsg(
						`Command "${name}" not found. Use /commands to list available commands.`,
						'commands',
					),
				);
			}
			return Promise.resolve(
				React.createElement(CommandDetail, {
					key: generateKey('commands-show'),
					command,
				}),
			);
		}

		if (sub === 'create') {
			return Promise.resolve(
				infoMsg(
					'Usage: /commands create <name>\nExample: /commands create review-code\n\nThis creates a new command file and starts an AI-assisted session to write its content.',
					'commands',
				),
			);
		}

		const commands = loader.getAllCommands() || [];

		return Promise.resolve(
			React.createElement(CustomCommands, {
				key: generateKey('custom-commands'),
				commands: commands,
			}),
		);
	},
};
