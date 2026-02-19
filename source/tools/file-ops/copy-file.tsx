import {constants} from 'node:fs';
import {access, copyFile, stat} from 'node:fs/promises';
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

interface CopyFileArgs {
	source: string;
	destination: string;
}

const executeCopyFile = async (args: CopyFileArgs): Promise<string> => {
	const srcAbsPath = resolve(args.source);
	const destAbsPath = resolve(args.destination);

	await copyFile(srcAbsPath, destAbsPath);
	invalidateCache(destAbsPath);

	return `File copied: ${args.source} → ${args.destination}`;
};

const copyFileCoreTool = tool({
	description:
		'Copy a file to a new location. Use this instead of execute_bash with cp.',
	inputSchema: jsonSchema<CopyFileArgs>({
		type: 'object',
		properties: {
			source: {
				type: 'string',
				description: 'The relative path of the file to copy.',
			},
			destination: {
				type: 'string',
				description: 'The relative path for the copy.',
			},
		},
		required: ['source', 'destination'],
	}),
	needsApproval: () => {
		if (isNanocoderToolAlwaysAllowed('copy_file')) {
			return false;
		}
		const mode = getCurrentMode();
		return mode !== 'auto-accept';
	},
	execute: async (args, _options) => {
		return await executeCopyFile(args);
	},
});

const CopyFileFormatter = React.memo(
	({args, result}: {args: CopyFileArgs; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext is required');
		}
		const {colors} = themeContext;

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ copy_file</Text>

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

const copyFileFormatter = (
	args: CopyFileArgs,
	result?: string,
): React.ReactElement => {
	return <CopyFileFormatter args={args} result={result} />;
};

const copyFileValidator = async (
	args: CopyFileArgs,
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

export const copyFileTool: NanocoderToolExport = {
	name: 'copy_file' as const,
	tool: copyFileCoreTool,
	formatter: copyFileFormatter,
	validator: copyFileValidator,
};
