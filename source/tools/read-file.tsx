import {constants} from 'node:fs';
import {access, lstat, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {
	FILE_READ_CHUNK_SIZE_LINES,
	FILE_READ_CHUNKING_HINT_THRESHOLD_LINES,
	FILE_READ_METADATA_THRESHOLD_LINES,
	MAX_LINE_LENGTH_CHARS,
} from '@/constants';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {getCachedFileContent} from '@/utils/file-cache';
import {getFileType} from '@/utils/file-type-detector';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';
import {calculateTokens} from '@/utils/token-calculator';

const executeReadFile = async (args: {
	path: string;
	start_line?: number;
	end_line?: number;
	metadata_only?: boolean;
}): Promise<string> => {
	const absPath = resolve(args.path);

	try {
		// Handle explicit metadata_only request
		if (args.metadata_only) {
			const stats = await lstat(absPath);

			// Determine file type
			let type: 'file' | 'directory' | 'symlink' = 'file';
			if (stats.isSymbolicLink()) {
				type = 'symlink';
			} else if (stats.isDirectory()) {
				type = 'directory';
			}

			const lastModified = new Date(stats.mtime).toISOString();
			const size = stats.size;

			let output = `File Information for "${args.path}"\n`;
			output += `${'='.repeat(50)}\n\n`;

			output += `Type: ${type}\n`;
			output += `Size: ${size.toLocaleString()} bytes\n`;
			output += `Last Modified: ${lastModified}\n`;

			// For regular files, try to get additional info
			if (type === 'file') {
				output += `Readable: yes\n`;

				// Try to detect encoding and line count
				try {
					const cached = await getCachedFileContent(absPath);
					const lines = cached.lines;
					const content = cached.content;

					output += `Lines: ${lines.length.toLocaleString()}\n`;
					output += `Estimated Tokens: ~${calculateTokens(content).toLocaleString()}\n`;

					// Detect file type from extension
					const fileType = getFileType(absPath);
					output += `File Type: ${fileType}\n`;

					// Detect likely encoding (simple heuristic)
					let encoding = 'UTF-8';
					try {
						// Try to read as UTF-8
						await readFile(absPath, 'utf-8');
					} catch {
						encoding = 'Binary/Unknown';
					}
					output += `Encoding: ${encoding}\n`;
				} catch (error: unknown) {
					// If we can't read it, mark as not readable
					output += `Readable: no\n`;
					const errorMessage =
						error instanceof Error ? error.message : 'Unknown error';
					output += `Note: Could not read file - ${errorMessage}\n`;
				}
			} else if (type === 'directory') {
				output += `Note: Use list_directory tool to see directory contents\n`;
			} else if (type === 'symlink') {
				output += `Note: This is a symbolic link. Size reflects link metadata, not target.\n`;
			}

			output += `\n[Use read_file to view file contents]\n`;

			return output;
		}

		const cached = await getCachedFileContent(absPath);
		const content = cached.content;

		// Check if file is empty (0 tokens)
		if (content.length === 0) {
			throw new Error(`File "${args.path}" exists but is empty (0 tokens)`);
		}

		const lines = cached.lines;
		const totalLines = lines.length;
		const fileSize = content.length;
		const estimatedTokens = calculateTokens(content);

		// Progressive disclosure: metadata first for files >300 lines
		// Small files can be read directly without ranges
		if (
			args.start_line === undefined &&
			args.end_line === undefined &&
			totalLines > FILE_READ_METADATA_THRESHOLD_LINES
		) {
			// Return metadata only for medium/large files
			// Detect file type from extension
			const fileType = getFileType(absPath);

			let output = `File: ${args.path}\n`;
			output += `Type: ${fileType}\n`;
			output += `Total lines: ${totalLines.toLocaleString()}\n`;
			output += `Size: ${fileSize.toLocaleString()} bytes\n`;
			output += `Estimated tokens: ~${estimatedTokens.toLocaleString()}\n\n`;

			if (totalLines <= FILE_READ_CHUNKING_HINT_THRESHOLD_LINES) {
				output += `[Medium file - To read specific sections, call read_file with start_line and end_line]\n`;
				output += `[To read entire file progressively, make multiple calls:]\n`;
				output += `  - read_file({path: "${args.path}", start_line: 1, end_line: ${FILE_READ_CHUNK_SIZE_LINES}})\n`;
				output += `  - read_file({path: "${args.path}", start_line: ${FILE_READ_CHUNK_SIZE_LINES + 1}, end_line: ${totalLines}})\n`;
			} else {
				output += `[Large file - Choose one approach:]\n`;
				output += `[1. Targeted read: Use search_files to find code, then read specific ranges]\n`;
				output += `[2. Progressive read: Read file in chunks (recommended chunk size: 200-300 lines)]\n`;
				output += `   Example chunks for ${totalLines} lines:\n`;
				const chunkSize = FILE_READ_CHUNK_SIZE_LINES;
				const numChunks = Math.ceil(totalLines / chunkSize);
				for (let i = 0; i < Math.min(numChunks, 3); i++) {
					const start = i * chunkSize + 1;
					const end = Math.min((i + 1) * chunkSize, totalLines);
					output += `   - read_file({path: "${args.path}", start_line: ${start}, end_line: ${end}})\n`;
				}
				if (numChunks > 3) {
					output += `   ... and ${numChunks - 3} more chunks to complete the file\n`;
				}
			}

			return output;
		}

		// Line ranges specified - read and return content
		const startLine = args.start_line ? Math.max(1, args.start_line) : 1;
		const endLine = args.end_line
			? Math.min(totalLines, args.end_line)
			: totalLines;

		// Extract the lines to return
		const linesToReturn = lines.slice(startLine - 1, endLine);

		// Return content without line numbers for clean content-based editing
		return linesToReturn.join('\n');
	} catch (error: unknown) {
		// Handle file not found and other filesystem errors
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			throw new Error(`File "${args.path}" does not exist`);
		}

		// Re-throw other errors (including our empty file error)
		throw error;
	}
};

const readFileCoreTool = tool({
	description:
		'Read file contents with line numbers. Use this INSTEAD OF bash cat/head/tail/less commands. PROGRESSIVE DISCLOSURE: Files ≤300 lines return content directly. Files >300 lines return metadata first - then call again with start_line/end_line to read specific sections. Use metadata_only=true for file info (size, lines, type) without reading content.',
	inputSchema: jsonSchema<{
		path: string;
		start_line?: number;
		end_line?: number;
		metadata_only?: boolean;
	}>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The path to the file to read.',
			},
			start_line: {
				type: 'number',
				description:
					'Optional: Line number to start reading from (1-indexed). Required for files >300 lines. Use with end_line to read specific range.',
			},
			end_line: {
				type: 'number',
				description:
					'Optional: Line number to stop reading at (inclusive). Required for files >300 lines. Use with start_line to read specific range.',
			},
			metadata_only: {
				type: 'boolean',
				description:
					'Optional: If true, returns only file metadata (size, line count, type, encoding, modification time) without content. Useful for quickly checking file properties.',
			},
		},
		required: ['path'],
	}),
	// Low risk: read-only operation, never requires approval
	needsApproval: false,
	execute: async (
		args: {
			path: string;
			start_line?: number;
			end_line?: number;
			metadata_only?: boolean;
		},
		_options: {toolCallId: string; messages: unknown[]},
	) => {
		return await executeReadFile(args);
	},
});

const ReadFileFormatter = React.memo(
	({
		args,
		fileInfo,
	}: {
		args: {
			path?: string;
			file_path?: string;
			start_line?: number;
			end_line?: number;
			metadata_only?: boolean;
		};
		fileInfo: {
			totalLines: number;
			readLines: number;
			tokens: number;
			isPartialRead: boolean;
			isMetadataOnly: boolean;
		};
	}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ReadFileFormatter must be used within a ThemeProvider');
		}
		const {colors} = themeContext;
		const path = args.path || args.file_path || 'unknown';

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ read_file</Text>

				<Box>
					<Text color={colors.secondary}>Path: </Text>
					<Box marginLeft={1} flexShrink={1}>
						<Text wrap="truncate-end" color={colors.text}>
							{path}
						</Text>
					</Box>
				</Box>

				{fileInfo.isMetadataOnly && (
					<Box>
						<Text color={colors.info}>(metadata only)</Text>
					</Box>
				)}

				{fileInfo.isMetadataOnly ? (
					<>
						<Box>
							<Text color={colors.secondary}>Total lines: </Text>
							<Text color={colors.text}>
								{fileInfo.totalLines.toLocaleString()}
							</Text>
						</Box>
					</>
				) : (
					<>
						<Box>
							<Text color={colors.secondary}>Lines: </Text>
							<Text color={colors.text}>
								{args.start_line || 1} - {args.end_line || fileInfo.totalLines}
							</Text>
						</Box>
					</>
				)}

				{!fileInfo.isMetadataOnly && (
					<Box>
						<Text color={colors.secondary}>Tokens: </Text>
						<Text color={colors.text}>~{fileInfo.tokens.toLocaleString()}</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const readFileFormatter = async (
	args: {
		path?: string;
		file_path?: string;
		start_line?: number;
		end_line?: number;
		metadata_only?: boolean;
	},
	result?: string,
): Promise<React.ReactElement> => {
	// If result is an error message, don't try to read the file
	if (result && result.startsWith('Error:')) {
		return <></>;
	}

	// Load file info to calculate actual read information
	let fileInfo = {
		totalLines: 0,
		readLines: 0,
		tokens: 0,
		isPartialRead: false,
		isMetadataOnly: false,
	};

	try {
		const path = args.path || args.file_path;
		if (path && typeof path === 'string') {
			const absPath = resolve(path);
			const cached = await getCachedFileContent(absPath);
			const content = cached.content;
			const lines = cached.lines;
			const totalLines = lines.length;

			// Detect if this was a metadata-only response
			const isMetadataOnly =
				(result?.startsWith('File:') ?? false) &&
				!args.start_line &&
				!args.end_line &&
				totalLines > FILE_READ_METADATA_THRESHOLD_LINES;

			// Calculate what was actually read
			const startLine = args.start_line || 1;
			const endLine = args.end_line || totalLines;
			const readLines = endLine - startLine + 1;
			const isPartialRead = startLine > 1 || endLine < totalLines;

			// Calculate tokens
			let tokens: number;
			if (isMetadataOnly) {
				// For metadata, show estimated tokens of the FULL FILE
				tokens = calculateTokens(content);
			} else {
				// For content reads, show tokens of what was actually returned
				tokens = result ? calculateTokens(result) : 0;
			}

			fileInfo = {
				totalLines,
				readLines,
				tokens,
				isPartialRead,
				isMetadataOnly,
			};
		}
	} catch {
		// File doesn't exist or can't be read - keep default fileInfo
	}

	return <ReadFileFormatter args={args} fileInfo={fileInfo} />;
};

const readFileValidator = async (args: {
	path: string;
	start_line?: number;
	end_line?: number;
	metadata_only?: boolean;
}): Promise<{valid: true} | {valid: false; error: string}> => {
	// Validate path boundary first to prevent directory traversal
	if (!isValidFilePath(args.path)) {
		return {
			valid: false,
			error: `⚒ Invalid file path: "${args.path}". Path must be relative and within the project directory.`,
		};
	}

	// Verify the resolved path stays within project boundaries
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

		// Validate line range parameters
		if (args.start_line !== undefined && args.start_line < 1) {
			return {
				valid: false,
				error: '⚒ start_line must be >= 1',
			};
		}

		if (
			args.start_line !== undefined &&
			args.end_line !== undefined &&
			args.end_line < args.start_line
		) {
			return {
				valid: false,
				error: '⚒ end_line must be >= start_line',
			};
		}

		// Auto-clamp end_line to file length instead of erroring
		if (args.end_line !== undefined) {
			const cached = await getCachedFileContent(absPath);
			const totalLines = cached.lines.length;

			if (args.end_line > totalLines) {
				args.end_line = totalLines;
			}
		}

		// Check for minified/binary content (very long lines)
		// Skip this check for metadata_only requests
		if (!args.metadata_only) {
			const cached = await getCachedFileContent(absPath);
			const startLine = args.start_line ? Math.max(1, args.start_line) : 1;
			const endLine = args.end_line
				? Math.min(cached.lines.length, args.end_line)
				: cached.lines.length;

			for (let i = startLine - 1; i < endLine; i++) {
				const line = cached.lines[i];
				if (line && line.length > MAX_LINE_LENGTH_CHARS) {
					return {
						valid: false,
						error: `⚒ File "${args.path}" contains minified or binary content (line ${i + 1} has ${line.length.toLocaleString()} characters). This file cannot be read as it would consume excessive tokens without providing useful information.`,
					};
				}
			}
		}

		return {valid: true};
	} catch (error: unknown) {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			return {
				valid: false,
				error: `⚒ File "${args.path}" does not exist`,
			};
		}
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		return {
			valid: false,
			error: `⚒ Cannot access file "${args.path}": ${errorMessage}`,
		};
	}
};

export const readFileTool: NanocoderToolExport = {
	name: 'read_file' as const,
	tool: readFileCoreTool,
	formatter: readFileFormatter,
	validator: readFileValidator,
	readOnly: true,
};
