import {lstat} from 'node:fs/promises';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {
	deleteDirectory,
	deleteFile,
	listDirectoryContents,
} from '@/utils/file-deletion';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

interface RmArgs {
	path: string;
	recursive?: boolean;
	force?: boolean;
}

const executeRm = async (args: RmArgs): Promise<string> => {
	const {path, recursive = false, force = false} = args;

	// Validate path structure
	if (!isValidFilePath(path)) {
		throw new Error(`Invalid file path: "${path}"`);
	}

	const cwd = process.cwd();
	const absPath = resolveFilePath(path, cwd);

	// Check if path exists
	const stats = await lstat(absPath);
	const isDirectory = stats.isDirectory();

	if (isDirectory && !recursive) {
		throw new Error(
			`Is a directory: "${path}". Use recursive=true to delete directories.`,
		);
	}

	// Get preview of directory contents for safe deletion
	let previewInfo = '';
	if (isDirectory) {
		const contents = await listDirectoryContents(absPath);
		if (contents.length > 0) {
			previewInfo = ` (${contents.length} items)`;
		}
	}

	// Perform deletion
	if (isDirectory) {
		await deleteDirectory(absPath, force);
	} else {
		await deleteFile(absPath, force);
	}

	// Build response
	const entityType = isDirectory ? 'directory' : 'file';
	return `✓ Removed ${entityType} "${path}"${previewInfo}`;
};

const rmCoreTool = tool({
	description:
		'Remove files or directories. Use this INSTEAD OF execute_bash with "rm" commands for better validation, safety, and rich feedback.',
	inputSchema: jsonSchema<RmArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'File/directory path to remove (required)',
			},
			recursive: {
				type: 'boolean',
				description: 'Remove directories and their contents (default: false)',
			},
			force: {
				type: 'boolean',
				description: 'Ignore nonexistent paths (default: false)',
			},
		},
		required: ['path'],
	}),
	needsApproval: () => {
		// Always require approval for deletion operations
		return true;
	},
	execute: async (args, _options) => {
		return await executeRm(args);
	},
});

interface RmFormatterProps {
	args: RmArgs;
	result?: string;
}

const RmFormatter = React.memo(({args, result}: RmFormatterProps) => {
	const themeContext = React.useContext(ThemeContext);
	if (!themeContext) {
		throw new Error('ThemeContext is required');
	}
	const {colors} = themeContext;

	const path = args.path || 'unknown';
	const recursive = args.recursive ?? false;
	const force = args.force ?? false;

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>⛑ rm</Text>

			<Box>
				<Text color={colors.secondary}>Path: </Text>
				<Text color={colors.text}>{path}</Text>
			</Box>

			<Box>
				<Text color={colors.secondary}>Recursive: </Text>
				<Text color={colors.text}>{recursive ? 'yes' : 'no'}</Text>
			</Box>

			<Box>
				<Text color={colors.secondary}>Force: </Text>
				<Text color={colors.text}>{force ? 'yes' : 'no'}</Text>
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

const rmFormatter = (args: RmFormatterProps['args']): React.ReactElement => {
	return <RmFormatter args={args} />;
};

const rmValidator = async (
	args: RmArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	if (!args.path || args.path.trim().length === 0) {
		return {valid: false, error: 'Path is required'};
	}

	if (!isValidFilePath(args.path)) {
		return {valid: false, error: `Invalid file path: "${args.path}"`};
	}

	// Check for dangerous patterns
	const dangerousPatterns = [
		/^\s*\/$/, // Root directory
		/^\s*\.\.\/\.\./, // Escaping parent
		/^\s*[A-Za-z]:\\/, // Windows system paths
		/^\s*node_modules\s*\*$/i, // node_modules glob (common mistake)
	];

	for (const pattern of dangerousPatterns) {
		if (pattern.test(args.path)) {
			return {
				valid: false,
				error: `Potentially dangerous deletion: ${args.path}`,
			};
		}
	}

	return {valid: true};
};

export const rmTool: NanocoderToolExport = {
	name: 'rm' as const,
	tool: rmCoreTool,
	formatter: rmFormatter,
	validator: rmValidator,
};
