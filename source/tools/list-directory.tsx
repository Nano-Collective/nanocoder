import {lstat, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import {jsonSchema, tool} from '@/types/core';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

interface ListDirectoryArgs {
	path?: string;
	recursive?: boolean;
	maxDepth?: number;
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

	// Validate path
	if (!isValidFilePath(dirPath)) {
		throw new Error(
			`Invalid path: "${dirPath}". Path must be relative and within the project directory.`,
		);
	}

	const cwd = process.cwd();
	const resolvedPath = resolveFilePath(dirPath, cwd);

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
					// Skip hidden files and common ignored directories
					if (item.name.startsWith('.') && !dirPath.startsWith('.')) {
						continue;
					}

					// Skip common ignored directories
					if (
						item.isDirectory() &&
						['node_modules', 'dist', 'build', '.git', 'coverage'].includes(
							item.name,
						)
					) {
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

		if (recursive && entries.length > 0) {
			output += `\n[Recursive: showing entries up to depth ${maxDepth}]`;
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
		'List directory contents. Shows files and subdirectories in a readable format. Use recursive=true to show nested directories. AUTO-ACCEPTED (no user approval needed). Great for exploring project structure without reading file contents.',
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
}

const ListDirectoryFormatter = React.memo(
	({args, result}: ListDirectoryFormatterProps) => {
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
				if (line.match(/^[📁🔗📄]/)) {
					entryCount++;
				}
			}
		}

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ list_directory</Text>

				<Box>
					<Text color={colors.secondary}>Path: </Text>
					<Text color={colors.white}>{args.path || '.'}</Text>
				</Box>

				{entryCount > 0 && (
					<Box>
						<Text color={colors.secondary}>Entries: </Text>
						<Text color={colors.white}>{entryCount}</Text>
					</Box>
				)}

				{args.recursive && (
					<Box>
						<Text color={colors.secondary}>Recursive: </Text>
						<Text color={colors.white}>
							yes (max depth: {args.maxDepth ?? 3})
						</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const listDirectoryFormatter = (
	args: ListDirectoryFormatterProps['args'],
	result?: string,
): React.ReactElement => {
	if (result && result.startsWith('Error:')) {
		return <></>;
	}
	return <ListDirectoryFormatter args={args} result={result} />;
};

export const listDirectoryTool = {
	name: 'list_directory' as const,
	tool: listDirectoryCoreTool,
	formatter: listDirectoryFormatter,
};
