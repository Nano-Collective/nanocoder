import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

interface CreateDirectoryArgs {
	path: string;
}

const executeCreateDirectory = async (
	args: CreateDirectoryArgs,
): Promise<string> => {
	const absPath = resolve(args.path);
	const alreadyExists = existsSync(absPath);

	await mkdir(absPath, {recursive: true});

	if (alreadyExists) {
		return `Directory already exists: ${args.path}`;
	}
	return `Directory created: ${args.path}`;
};

const createDirectoryCoreTool = tool({
	description:
		'Create a directory, including parent directories if needed. Idempotent — succeeds if the directory already exists. AUTO-ACCEPTED (no user approval needed).',
	inputSchema: jsonSchema<CreateDirectoryArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description:
					'The relative path of the directory to create (e.g., "src/components/new-feature").',
			},
		},
		required: ['path'],
	}),
	// Low risk: creating directories is non-destructive and idempotent
	needsApproval: false,
	execute: async (args, _options) => {
		return await executeCreateDirectory(args);
	},
});

const CreateDirectoryFormatter = React.memo(
	({args, result}: {args: CreateDirectoryArgs; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext is required');
		}
		const {colors} = themeContext;

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ create_directory</Text>

				<Box>
					<Text color={colors.secondary}>Path: </Text>
					<Text color={colors.text}>{args.path}</Text>
				</Box>

				{result && (
					<Box>
						<Text color={colors.secondary}>Result: </Text>
						<Text color={colors.text}>{result}</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const createDirectoryFormatter = (
	args: CreateDirectoryArgs,
	result?: string,
): React.ReactElement => {
	return <CreateDirectoryFormatter args={args} result={result} />;
};

const createDirectoryValidator = async (
	args: CreateDirectoryArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	if (!isValidFilePath(args.path)) {
		return {
			valid: false,
			error: `⚒ Invalid path: "${args.path}". Path must be relative and within the project directory.`,
		};
	}

	try {
		const cwd = process.cwd();
		resolveFilePath(args.path, cwd);
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		return {
			valid: false,
			error: `⚒ Path validation failed: ${errorMessage}`,
		};
	}

	return {valid: true};
};

export const createDirectoryTool: NanocoderToolExport = {
	name: 'create_directory' as const,
	tool: createDirectoryCoreTool,
	formatter: createDirectoryFormatter,
	validator: createDirectoryValidator,
};
