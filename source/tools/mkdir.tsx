import {existsSync} from 'node:fs';
import {lstat, mkdir} from 'node:fs/promises';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {getCurrentMode} from '@/context/mode-context';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

interface MkdirArgs {
	path: string;
	recursive?: boolean;
	mode?: string;
}

const executeMkdir = async (args: MkdirArgs): Promise<string> => {
	const {path, recursive = false, mode = '755'} = args;

	// Validate path structure
	if (!isValidFilePath(path)) {
		throw new Error(`Invalid file path: "${path}"`);
	}

	const cwd = process.cwd();
	const absPath = resolveFilePath(path, cwd);

	// Check if path already exists
	if (existsSync(absPath)) {
		const stats = await lstat(absPath);
		if (stats.isDirectory()) {
			return `Directory "${path}" already exists`;
		}
		throw new Error(`Path exists as file: "${path}"`);
	}

	// Parse and validate mode
	const modeNum = parseInt(mode, 8);
	if (isNaN(modeNum) || modeNum < 0 || modeNum > 0o777) {
		throw new Error(`Invalid mode: "${mode}". Use format "755"`);
	}

	// Create directory
	await mkdir(absPath, {recursive, mode: modeNum});

	// Build response
	if (recursive) {
		return `✓ Created directory structure for "${path}"`;
	}
	return `✓ Created directory "${path}"`;
};

const mkdirCoreTool = tool({
	description:
		'Create a directory with optional recursive creation. Use this INSTEAD OF execute_bash with "mkdir" commands for better validation, safety, and rich feedback. Creates parent directories recursively when recursive=true.',
	inputSchema: jsonSchema<MkdirArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Directory path to create (required)',
			},
			recursive: {
				type: 'boolean',
				description: 'Create parent directories as needed (default: false)',
			},
			mode: {
				type: 'string',
				description: 'Unix permission mode (e.g., "755", default: "755")',
			},
		},
		required: ['path'],
	}),
	needsApproval: () => {
		const mode = getCurrentMode();
		return mode !== 'auto-accept';
	},
	execute: async (args, _options) => {
		return await executeMkdir(args);
	},
});

interface MkdirFormatterProps {
	args: MkdirArgs;
	result?: string;
}

const MkdirFormatter = React.memo(({args, result}: MkdirFormatterProps) => {
	const themeContext = React.useContext(ThemeContext);
	if (!themeContext) {
		throw new Error('ThemeContext is required');
	}
	const {colors} = themeContext;

	const path = args.path || 'unknown';
	const recursive = args.recursive ?? false;
	const mode = args.mode || '755';

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>⚒ mkdir</Text>

			<Box>
				<Text color={colors.secondary}>Path: </Text>
				<Text color={colors.text}>{path}</Text>
			</Box>

			<Box>
				<Text color={colors.secondary}>Recursive: </Text>
				<Text color={colors.text}>{recursive ? 'yes' : 'no'}</Text>
			</Box>

			<Box>
				<Text color={colors.secondary}>Mode: </Text>
				<Text color={colors.text}>{mode}</Text>
			</Box>

			{result && (
				<Box marginTop={1}>
					<Text color={colors.text}>{result}</Text>
				</Box>
			)}
		</Box>
	);

	return <ToolMessage message={messageContent} hideBox={true} />;
});

const mkdirFormatter = (
	args: MkdirFormatterProps['args'],
): React.ReactElement => {
	return <MkdirFormatter args={args} />;
};

const mkdirValidator = async (
	args: MkdirArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	if (!args.path || args.path.trim().length === 0) {
		return {valid: false, error: 'Path is required'};
	}

	if (!isValidFilePath(args.path)) {
		return {valid: false, error: `Invalid file path: "${args.path}"`};
	}

	// Validate mode format if provided
	if (args.mode && !/^[0-7]{3,4}$/.test(args.mode)) {
		return {
			valid: false,
			error: `Invalid mode: "${args.mode}". Use format "755" or "0755"`,
		};
	}

	return {valid: true};
};

export const mkdirTool: NanocoderToolExport = {
	name: 'mkdir' as const,
	tool: mkdirCoreTool,
	formatter: mkdirFormatter,
	validator: mkdirValidator,
};
