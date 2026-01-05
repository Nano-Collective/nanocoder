import {lstat, rmdir} from 'node:fs/promises';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {isEmptyDirectory} from '@/utils/file-deletion';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

interface RmdirArgs {
	path: string;
}

const executeRmdir = async (args: RmdirArgs): Promise<string> => {
	const {path} = args;

	// Validate path structure
	if (!isValidFilePath(path)) {
		throw new Error(`Invalid file path: "${path}"`);
	}

	const cwd = process.cwd();
	const absPath = resolveFilePath(path, cwd);

	// Check if path exists and is directory
	const stats = await lstat(absPath);
	if (!stats.isDirectory()) {
		throw new Error(`Not a directory: "${path}"`);
	}

	// Check if directory is empty
	if (!(await isEmptyDirectory(absPath))) {
		throw new Error(
			`Directory not empty: "${path}". ` +
				`Use rm with recursive=true to delete non-empty directories.`,
		);
	}

	// Delete the empty directory
	await rmdir(absPath);

	return `✓ Removed empty directory "${path}"`;
};

const rmdirCoreTool = tool({
	description:
		'Remove empty directories only. Provides safer alternative to rm for cleaning up empty directories.',
	inputSchema: jsonSchema<RmdirArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Path to empty directory to remove (required)',
			},
		},
		required: ['path'],
	}),
	needsApproval: () => {
		// Always require approval for deletion operations
		return true;
	},
	execute: async (args, _options) => {
		return await executeRmdir(args);
	},
});

interface RmdirFormatterProps {
	args: RmdirArgs;
	result?: string;
}

const RmdirFormatter = React.memo(({args, result}: RmdirFormatterProps) => {
	const themeContext = React.useContext(ThemeContext);
	if (!themeContext) {
		throw new Error('ThemeContext is required');
	}
	const {colors} = themeContext;

	const path = args.path || 'unknown';

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>⛑ rmdir</Text>

			<Box>
				<Text color={colors.secondary}>Path: </Text>
				<Text color={colors.text}>{path}</Text>
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

const rmdirFormatter = (
	args: RmdirFormatterProps['args'],
): React.ReactElement => {
	return <RmdirFormatter args={args} />;
};

const rmdirValidator = async (
	args: RmdirArgs,
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

export const rmdirTool: NanocoderToolExport = {
	name: 'rmdir' as const,
	tool: rmdirCoreTool,
	formatter: rmdirFormatter,
	validator: rmdirValidator,
};
