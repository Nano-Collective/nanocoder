import {execSync} from 'child_process';
import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {Box, Text} from 'ink';
import {dirname, join} from 'path';
import React from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {confDirMap} from '@/config/index';
import {getConfigPath} from '@/config/paths';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {Command} from '@/types/commands';

interface ConfigOption {
	label: string;
	path: string;
	description: string;
}

function getConfigOptions(): ConfigOption[] {
	const globalDir = getConfigPath();
	const cwdDir = process.cwd();

	const options: ConfigOption[] = [];

	// agents.config.json — show project-level if it exists, always show global
	const projectAgentsConfig = join(cwdDir, 'agents.config.json');
	const globalAgentsConfig = join(globalDir, 'agents.config.json');

	if (existsSync(projectAgentsConfig)) {
		options.push({
			label: 'agents.config.json (project)',
			path: projectAgentsConfig,
			description: 'Project-level provider, tool, and session config',
		});
	}

	options.push({
		label: 'agents.config.json (global)',
		path: globalAgentsConfig,
		description: 'Global provider, tool, and session config',
	});

	// .mcp.json — project and global
	const projectMcp = join(cwdDir, '.mcp.json');
	const globalMcp = join(globalDir, '.mcp.json');

	if (existsSync(projectMcp)) {
		options.push({
			label: '.mcp.json (project)',
			path: projectMcp,
			description: 'Project-level MCP server configuration',
		});
	}

	options.push({
		label: '.mcp.json (global)',
		path: globalMcp,
		description: 'Global MCP server configuration',
	});

	// Preferences
	const loadedPreferences = confDirMap['nanocoder-preferences.json'];
	if (loadedPreferences) {
		options.push({
			label: 'nanocoder-preferences.json',
			path: loadedPreferences,
			description: 'User preferences (theme, shapes, last model)',
		});
	}

	return options;
}

function getEditor(): string {
	if (process.env.EDITOR) return process.env.EDITOR;
	if (process.env.VISUAL) return process.env.VISUAL;

	// When running inside VS Code's integrated terminal, default to code
	if (process.env.TERM_PROGRAM === 'vscode') return 'code --wait';

	return 'vi';
}

function ensureFileExists(filePath: string): void {
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, {recursive: true});
	}
	if (!existsSync(filePath)) {
		if (filePath.endsWith('.json')) {
			writeFileSync(filePath, '{}\n', 'utf-8');
		} else {
			writeFileSync(filePath, '', 'utf-8');
		}
	}
}

function openInEditor(filePath: string): void {
	const editor = getEditor();
	ensureFileExists(filePath);
	// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
	execSync(`${editor} ${JSON.stringify(filePath)}`, {stdio: 'inherit'});
}

function SetupConfigResult({
	options,
	selectedIndex,
	error,
}: {
	options: ConfigOption[];
	selectedIndex?: number;
	error?: string;
}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const editor = getEditor();

	if (error) {
		return (
			<Box flexDirection="column">
				<Text color={colors.error}>{error}</Text>
			</Box>
		);
	}

	if (selectedIndex !== undefined) {
		const option = options[selectedIndex];
		if (!option) {
			return (
				<Box>
					<Text color={colors.error}>Invalid selection</Text>
				</Box>
			);
		}
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Text color={colors.success}>
					Opened {option.label} in {editor}
				</Text>
				<Text color={colors.secondary}>{option.path}</Text>
			</Box>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Configuration Files"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{options.map((option, i) => (
				<Box key={option.path} flexDirection="column" marginBottom={1}>
					<Text>
						<Text color={colors.text} bold>
							{i + 1}.{' '}
						</Text>
						<Text color={colors.text}>{option.label}</Text>
					</Text>
					<Text color={colors.secondary}> {option.description}</Text>
					<Text color={colors.secondary}> {option.path}</Text>
				</Box>
			))}
			<Text color={colors.secondary}>
				Usage: /setup-config {'<number>'} to open in{' '}
				<Text color={colors.text}>{editor}</Text>
			</Text>
		</TitledBoxWithPreferences>
	);
}

export const setupConfigCommand: Command = {
	name: 'setup-config',
	description: 'Open a configuration file in your editor',
	handler: async (args: string[]) => {
		const options = getConfigOptions();

		if (args.length === 0) {
			return React.createElement(SetupConfigResult, {options});
		}

		const selection = Number.parseInt(args[0] ?? '', 10);

		if (
			Number.isNaN(selection) ||
			selection < 1 ||
			selection > options.length
		) {
			return React.createElement(SetupConfigResult, {
				options,
				error: `Invalid selection "${args[0]}". Choose a number between 1 and ${options.length}.`,
			});
		}

		try {
			const selected = options[selection - 1];
			if (!selected) {
				return React.createElement(SetupConfigResult, {
					options,
					error: `Invalid selection "${args[0]}".`,
				});
			}
			openInEditor(selected.path);
			return React.createElement(SetupConfigResult, {
				options,
				selectedIndex: selection - 1,
			});
		} catch (error) {
			return React.createElement(SetupConfigResult, {
				options,
				error: `Failed to open editor: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	},
};
