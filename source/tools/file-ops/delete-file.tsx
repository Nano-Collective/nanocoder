import {constants} from 'node:fs';
import {access, rm, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {invalidateCache} from '@/utils/file-cache';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

interface DeleteFileArgs {
	path: string;
}

const executeDeleteFile = async (args: DeleteFileArgs): Promise<string> => {
	const absPath = resolve(args.path);

	const fileStat = await stat(absPath);
	if (fileStat.isDirectory()) {
		return `Error: "${args.path}" is a directory. Use execute_bash with rm -r for directory removal.`;
	}

	await rm(absPath);
	invalidateCache(absPath);

	return `File deleted: ${args.path}`;
};

const deleteFileCoreTool = tool({
	description:
		'Delete a file. Only deletes single files, not directories. Always requires user approval.',
	inputSchema: jsonSchema<DeleteFileArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The relative path to the file to delete.',
			},
		},
		required: ['path'],
	}),
	// High risk: destructive operation, always requires approval
	needsApproval: true,
	execute: async (args, _options) => {
		return await executeDeleteFile(args);
	},
});

const DeleteFileFormatter = React.memo(
	({args, result}: {args: DeleteFileArgs; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext is required');
		}
		const {colors} = themeContext;

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ delete_file</Text>

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

const deleteFileFormatter = (
	args: DeleteFileArgs,
	result?: string,
): React.ReactElement => {
	return <DeleteFileFormatter args={args} result={result} />;
};

const deleteFileValidator = async (
	args: DeleteFileArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	if (!isValidFilePath(args.path)) {
		return {
			valid: false,
			error: `⚒ Invalid file path: "${args.path}". Path must be relative and within the project directory.`,
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

	const absPath = resolve(args.path);

	try {
		await access(absPath, constants.F_OK);
	} catch {
		return {
			valid: false,
			error: `⚒ File does not exist: "${args.path}"`,
		};
	}

	return {valid: true};
};

export const deleteFileTool: NanocoderToolExport = {
	name: 'delete_file' as const,
	tool: deleteFileCoreTool,
	formatter: deleteFileFormatter,
	validator: deleteFileValidator,
};
