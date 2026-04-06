import {lstat, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {loadGitignore} from '@/utils/gitignore-loader';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';
import {calculateTokens} from '@/utils/token-calculator';

interface ListDirectoryArgs {
	path?: string;
	recursive?: boolean;
	maxDepth?: number;
	tree?: boolean;
	showHiddenFiles?: boolean;
}

interface DirectoryEntry {
	name: string;
	relativePath: string;
	type: 'file' | 'directory' | 'symlink';
	size?: number;
}

const executeListDirectory = async (
	args: ListDirectoryArgs,
): Promise<string> => {
	const dirPath = args.path || '.';
	const recursive = args.recursive ?? false;
	const maxDepth = args.maxDepth ?? 3;
	const tree = args.tree ?? false;
	const showHiddenFiles = args.showHiddenFiles ?? false;

	// Validate path
	if (!isValidFilePath(dirPath)) {
		throw new Error(
			`⚒ Invalid path. Path must be relative and within the project directory.`,
		);
	}

	const cwd = process.cwd();
	const resolvedPath = resolveFilePath(dirPath, cwd);
	const ig = loadGitignore(cwd);

	try {
		const entries: DirectoryEntry[] = [];

		const walkDirectory = async (
			currentPath: string,
			relativeTo: string,
			depth: number,
		): Promise<void> => {
			if (depth > maxDepth) return;

			try {
				const items = await readdir(currentPath, {withFileTypes: true});

				for (const item of items) {
					// Skip hidden files unless showHiddenFiles is true
					if (
						!showHiddenFiles &&
						item.name.startsWith('.') &&
						!dirPath.startsWith('.')
					) {
						continue;
					}

					// Check if this item should be ignored using gitignore patterns
					const itemPath = relativeTo ? join(relativeTo, item.name) : item.name;
					if (ig.ignores(itemPath)) {
						continue;
					}

					let type: 'file' | 'directory' | 'symlink' = 'file';
					if (item.isSymbolicLink()) {
						type = 'symlink';
					} else if (item.isDirectory()) {
						type = 'directory';
					}

					const fullPath = join(currentPath, item.name);
					const relativePath = join(relativeTo, item.name);

					// Only get stats for files (to get size)
					let size: number | undefined;
					if (type === 'file') {
						try {
							const stats = await lstat(fullPath);
							size = stats.size;
						} catch {
							// Skip files we can't stat
							size = undefined;
						}
					}

					entries.push({
						name: item.name,
						relativePath,
						type,
						size,
					});

					// Recurse into directories if enabled
					if (recursive && item.isDirectory() && depth < maxDepth) {
						await walkDirectory(fullPath, relativePath, depth + 1);
					}
				}
			} catch (error: unknown) {
				if (
					error instanceof Error &&
					'code' in error &&
					error.code === 'EACCES'
				) {
					// Skip directories we can't read
					return;
				}
				throw error;
			}
		};

		await walkDirectory(resolvedPath, '', 0);

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
			// Standard format with icons
			for (const entry of entries) {
				const icon =
					entry.type === 'directory'
						? '📁 '
						: entry.type === 'symlink'
							? '🔗 '
							: '📄 ';
				const displayPath = recursive ? entry.relativePath : entry.name;
				const sizeStr = entry.size
					? ` (${entry.size.toLocaleString()} bytes)`
					: '';
				output += `${icon}${displayPath}${sizeStr}\n`;
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
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		throw new Error(`Failed to list directory: ${errorMessage}`);
	}
};

const listDirectoryCoreTool = tool({
	description:
		'List directory contents with file sizes. Use this INSTEAD OF bash ls/ls -la/ls -R commands. Use recursive=true with maxDepth for nested exploration. Use tree=true for flat paths (easier to parse). Best for: exploring unknown directories, seeing file sizes, understanding project structure. For finding specific files by pattern, use find_files instead.',
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
		},
		required: [],
	}),
	// Low risk: read-only operation, never requires approval
	needsApproval: false,
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
				// Count lines with emojis (standard format) or paths (tree format)
				if (
					line.match(/^[📁🔗📄]/) ||
					(args.tree &&
						line.trim() &&
						!line.startsWith('[') &&
						!line.startsWith('Directory'))
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
		tokens = calculateTokens(result);
	}

	return <ListDirectoryFormatter args={args} result={result} tokens={tokens} />;
};

export const listDirectoryTool: NanocoderToolExport = {
	name: 'list_directory' as const,
	tool: listDirectoryCoreTool,
	formatter: listDirectoryFormatter,
	readOnly: true,
};
