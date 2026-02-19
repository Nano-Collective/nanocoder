import {constants} from 'node:fs';
import {access, rename, stat} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {isNanocoderToolAlwaysAllowed} from '@/config/nanocoder-tools-config';
import {getCurrentMode} from '@/context/mode-context';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {invalidateCache} from '@/utils/file-cache';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

interface MoveFileArgs {
	source: string;
	destination: string;
}

const executeMoveFile = async (args: MoveFileArgs): Promise<string> => {
	const srcAbsPath = resolve(args.source);
	const destAbsPath = resolve(args.destination);

	await rename(srcAbsPath, destAbsPath);
	invalidateCache(srcAbsPath);

	return `File moved: ${args.source} → ${args.destination}`;
};

const moveFileCoreTool = tool({
	description:
		'Move or rename a file. Use this instead of execute_bash with mv.',
	inputSchema: jsonSchema<MoveFileArgs>({
		type: 'object',
		properties: {
			source: {
				type: 'string',
				description: 'The current relative path of the file.',
			},
			destination: {
				type: 'string',
				description: 'The new relative path for the file.',
			},
		},
		required: ['source', 'destination'],
	}),
	needsApproval: () => {
		if (isNanocoderToolAlwaysAllowed('move_file')) {
			return false;
		}
		const mode = getCurrentMode();
		return mode !== 'auto-accept';
	},
	execute: async (args, _options) => {
		return await executeMoveFile(args);
	},
});

const MoveFileFormatter = React.memo(
	({args, result}: {args: MoveFileArgs; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext is required');
		}
		const {colors} = themeContext;

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ move_file</Text>

				<Box>
					<Text color={colors.secondary}>Source: </Text>
					<Text color={colors.text}>{args.source}</Text>
				</Box>

				<Box>
					<Text color={colors.secondary}>Destination: </Text>
					<Text color={colors.text}>{args.destination}</Text>
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

const moveFileFormatter = (
	args: MoveFileArgs,
	result?: string,
): React.ReactElement => {
	return <MoveFileFormatter args={args} result={result} />;
};

const moveFileValidator = async (
	args: MoveFileArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	// Validate source path
	if (!isValidFilePath(args.source)) {
		return {
			valid: false,
			error: `⚒ Invalid source path: "${args.source}". Path must be relative and within the project directory.`,
		};
	}

	// Validate destination path
	if (!isValidFilePath(args.destination)) {
		return {
			valid: false,
			error: `⚒ Invalid destination path: "${args.destination}". Path must be relative and within the project directory.`,
		};
	}

	try {
		const cwd = process.cwd();
		resolveFilePath(args.source, cwd);
		resolveFilePath(args.destination, cwd);
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		return {
			valid: false,
			error: `⚒ Path validation failed: ${errorMessage}`,
		};
	}

	// Check source exists
	const srcAbsPath = resolve(args.source);
	try {
		await access(srcAbsPath, constants.F_OK);
	} catch {
		return {
			valid: false,
			error: `⚒ Source file does not exist: "${args.source}"`,
		};
	}

	// Check source is a file
	const fileStat = await stat(srcAbsPath);
	if (fileStat.isDirectory()) {
		return {
			valid: false,
			error: `⚒ Source is a directory, not a file: "${args.source}"`,
		};
	}

	// Check destination parent directory exists
	const destAbsPath = resolve(args.destination);
	const parentDir = dirname(destAbsPath);
	try {
		await access(parentDir, constants.F_OK);
	} catch {
		return {
			valid: false,
			error: `⚒ Destination parent directory does not exist: "${parentDir}"`,
		};
	}

	return {valid: true};
};

export const moveFileTool: NanocoderToolExport = {
	name: 'move_file' as const,
	tool: moveFileCoreTool,
	formatter: moveFileFormatter,
	validator: moveFileValidator,
};
