import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import {getProjectRoot, getSafeSessionCwd} from '@/services/session-cwd';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {walkDirectory} from '@/utils/fs/directory-walker';
import {isValidFilePath, resolveFilePath} from '@/utils/fs/path-validation';
import {estimateTokens} from '@/utils/token-calculator';

interface ListDirectoryArgs {
	path?: string;
	recursive?: boolean;
	maxDepth?: number;
	tree?: boolean;
	showHiddenFiles?: boolean;
	showSizes?: boolean;
}

const executeListDirectory = async (
	args: ListDirectoryArgs,
): Promise<string> => {
	const dirPath = args.path || '.';
	const recursive = args.recursive ?? false;
	const maxDepth = args.maxDepth ?? 3;
	const tree = args.tree ?? false;
	const showHiddenFiles = args.showHiddenFiles ?? false;
	const showSizes = args.showSizes ?? false;

	// Validate path
	const cwd = getSafeSessionCwd();
	const root = getProjectRoot();
	if (!isValidFilePath(dirPath, root)) {
		throw new Error(
			`⚒ Invalid path. Path must be within the project directory.`,
		);
	}

	const resolvedPath = resolveFilePath(dirPath, cwd, root);

	try {
		const {entries} = await walkDirectory({
			root,
			dirPath: resolvedPath,
			recursive,
			maxDepth,
			showHiddenFiles,
			showSizes,
		});

		if (entries.length === 0) {
			return `Directory "${dirPath}" is empty`;
		}

		// Sort directories first, then files, alphabetically
		entries.sort((a, b) => {
			if (a.type === 'directory' && b.type !== 'directory') return -1;
			if (a.type !== 'directory' && b.type === 'directory') return 1;
			return a.relativePath.localeCompare(b.relativePath);
		});

		// Format output
		let output = `Directory contents for "${dirPath}":\n\n`;

		if (tree) {
			// Tree format: flat paths, one per line
			for (const entry of entries) {
				output += `${entry.relativePath}\n`;
			}
		} else {
			// Standard format: directories get a trailing "/", symlinks "@" (ls -F style)
			for (const entry of entries) {
				const suffix =
					entry.type === 'directory'
						? '/'
						: entry.type === 'symlink'
							? '@'
							: '';
				const displayPath = recursive ? entry.relativePath : entry.name;
				const sizeStr = entry.size ? ` (${entry.size} bytes)` : '';
				output += `${displayPath}${suffix}${sizeStr}\n`;
			}
		}

		if (recursive && entries.length > 0) {
			output += `\n[Recursive: showing entries up to depth ${maxDepth}]`;
		}

		if (tree) {
			output += `\n[Tree format: flat paths]`;
		}

		return output;
	} catch (error: unknown) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			throw new Error(`Directory "${dirPath}" does not exist`);
		}
		const errorMessage = formatError(error);
		throw new Error(`Failed to list directory: ${errorMessage}`);
	}
};

const listDirectoryCoreTool = tool({
	description:
		"List directory contents. Use this INSTEAD OF bash ls/ls -la/ls -R commands. Use recursive=true with maxDepth for nested exploration. Use tree=true for flat paths (easier to parse). Use showSizes=true to include file sizes (off by default; use read_file with metadata_only=true for a single file's size instead). Best for: exploring unknown directories, understanding project structure. For finding specific files by pattern, use find_files instead.",
	inputSchema: jsonSchema<ListDirectoryArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description:
					'Directory path to list (default: "." current directory). Examples: ".", "src", "source/tools"',
			},
			recursive: {
				type: 'boolean',
				description:
					'If true, recursively list subdirectories (default: false)',
			},
			maxDepth: {
				type: 'number',
				description:
					'Maximum recursion depth when recursive=true (default: 3, min: 1, max: 10)',
			},
			tree: {
				type: 'boolean',
				description:
					'If true, show flat paths output (one per line) instead of formatted tree. Great for LLM to see project structure.',
			},
			showHiddenFiles: {
				type: 'boolean',
				description:
					'If true, include hidden files and directories (default: false). Use with caution to avoid exposing sensitive files like .env.',
			},
			showSizes: {
				type: 'boolean',
				description:
					"If true, include each file's size in bytes (default: false). Rarely needed just to orient in a directory; costs an extra stat call per file plus output tokens.",
			},
		},
		required: [],
	}),
	execute: async (args, _options) => {
		return await executeListDirectory(args);
	},
});

interface ListDirectoryFormatterProps {
	args: ListDirectoryArgs;
	result?: string;
	tokens?: number;
}

const ListDirectoryFormatter = React.memo(
	({args, result, tokens}: ListDirectoryFormatterProps) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext not found');
		}
		const {colors} = themeContext;

		// Parse result to extract entry count
		let entryCount = 0;
		if (
			result &&
			!result.startsWith('Error:') &&
			!result.includes('is empty')
		) {
			const lines = result.split('\n');
			for (const line of lines) {
				// Count entry lines (skip the header, blank lines, and bracketed notes)
				const trimmed = line.trim();
				if (
					trimmed &&
					!trimmed.startsWith('[') &&
					!trimmed.startsWith('Directory')
				) {
					entryCount++;
				}
			}
		}

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ list_directory</Text>

				<Box>
					<Text color={colors.secondary}>Path: </Text>
					<Text wrap="truncate-end" color={colors.text}>
						{args.path || '.'}
					</Text>
				</Box>

				{entryCount > 0 && (
					<Box>
						<Text color={colors.secondary}>Entries: </Text>
						<Text color={colors.text}>{entryCount}</Text>
					</Box>
				)}

				{args.recursive && (
					<Box>
						<Text color={colors.secondary}>Recursive: </Text>
						<Text color={colors.text}>
							yes (max depth: {args.maxDepth ?? 3})
						</Text>
					</Box>
				)}

				{args.tree && (
					<Box>
						<Text color={colors.secondary}>Format: </Text>
						<Text color={colors.text}>tree</Text>
					</Box>
				)}

				{args.showHiddenFiles && (
					<Box>
						<Text color={colors.secondary}>Hidden files: </Text>
						<Text color={colors.text}>shown</Text>
					</Box>
				)}

				{tokens !== undefined && tokens > 0 && (
					<Box>
						<Text color={colors.secondary}>Tokens: </Text>
						<Text color={colors.text}>~{tokens.toLocaleString()}</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const listDirectoryFormatter = (
	args: ListDirectoryArgs,
	result?: string,
): React.ReactElement => {
	if (result && result.startsWith('Error:')) {
		return <></>;
	}

	// Calculate tokens from the result
	let tokens = 0;
	if (result) {
		tokens = estimateTokens(result);
	}

	return <ListDirectoryFormatter args={args} result={result} tokens={tokens} />;
};

export const listDirectoryTool: NanocoderToolExport = {
	name: 'list_directory' as const,
	tool: listDirectoryCoreTool,
	formatter: listDirectoryFormatter,
	readOnly: true,
};
