import {constants} from 'node:fs';
import {access, lstat, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {
	EMPTY_CONTENT_MARKER,
	FILE_READ_PREVIEW_LINES,
	FILE_READ_PREVIEW_THRESHOLD_LINES,
	MAX_LINE_LENGTH_CHARS,
} from '@/constants';
import {ThemeContext} from '@/hooks/useTheme';
import {getProjectRoot, getSafeSessionCwd} from '@/services/session-cwd';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {getCachedFileContent} from '@/utils/file-cache';
import {getFileType} from '@/utils/file-type-detector';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';
import {markFileSeen} from '@/utils/read-tracker';
import {calculateTokens} from '@/utils/token-calculator';

const executeReadFile = async (args: {
	path: string;
	start_line?: number;
	end_line?: number;
	metadata_only?: boolean;
}): Promise<string> => {
	const absPath = resolve(getSafeSessionCwd(), args.path);

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
			output += `Size: ${size} bytes\n`;
			output += `Last Modified: ${lastModified}\n`;

			// For regular files, try to get additional info
			if (type === 'file') {
				output += `Readable: yes\n`;

				// Try to detect encoding and line count
				try {
					const cached = await getCachedFileContent(absPath);
					const lines = cached.lines;
					const content = cached.content;

					output += `Lines: ${lines.length}\n`;
					output += `Estimated Tokens: ~${calculateTokens(content)}\n`;

					// Detect file type from extension
					const fileType = getFileType(absPath);
					output += `File Type: ${fileType}\n`;

					// Detect likely encoding (simple heuristic)
					let encoding = 'UTF-8';
					try {
						if (
							absPath.toLowerCase().endsWith('.pdf') ||
							absPath.toLowerCase().endsWith('.docx')
						) {
							encoding = 'Binary (Converted to Markdown)';
						} else {
							// Try to read as UTF-8
							await readFile(absPath, 'utf-8');
						}
					} catch (_error: unknown) {
						encoding = 'Binary/Unknown';
					}
					output += `Encoding: ${encoding}\n`;
				} catch (error: unknown) {
					// If we can't read it, mark as not readable
					output += `Readable: no\n`;
					const errorMessage = formatError(error);
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

		if (content.length === 0) {
			// An empty file has been seen in full; allow edits/overwrites against it.
			markFileSeen(absPath);
			return EMPTY_CONTENT_MARKER;
		}

		const lines = cached.lines;
		const totalLines = lines.length;

		// Return a bounded preview only for very large files. Most files can be
		// understood and edited after a single read; truly large files still have
		// an explicit, recoverable path to the remaining content.
		if (
			args.start_line === undefined &&
			args.end_line === undefined &&
			totalLines > FILE_READ_PREVIEW_THRESHOLD_LINES
		) {
			const previewEndLine = Math.min(FILE_READ_PREVIEW_LINES, totalLines);
			const preview = lines.slice(0, previewEndLine).join('\n');

			// The model has received real content, even though the rest is omitted.
			// Marking it seen keeps the read-before-edit guard aligned with the
			// content that was actually returned, just like a ranged read.
			markFileSeen(absPath);

			return `${preview}\n\n[Truncated at line ${previewEndLine} of ${totalLines}. Use read_file with start_line: ${previewEndLine + 1} and end_line to continue.]`;
		}

		// Line ranges specified - read and return content
		const startLine = args.start_line ? Math.max(1, args.start_line) : 1;
		const endLine = args.end_line
			? Math.min(totalLines, args.end_line)
			: totalLines;

		// Extract the lines to return
		const linesToReturn = lines.slice(startLine - 1, endLine);

		// Content (full file or an explicit range) has been returned to the model,
		// so it has now "seen" this file for read-before-edit purposes.
		markFileSeen(absPath);

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

		throw error;
	}
};

const readFileCoreTool = tool({
	description:
		'Read file contents. Use this INSTEAD OF bash cat/head/tail/less commands. PROGRESSIVE DISCLOSURE: Files ≤1500 lines return content directly. Larger files return a 250-line preview with a continuation hint - use start_line/end_line to read additional sections. Use metadata_only=true for file info (size, lines, type) without reading content.',
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
					'Optional: Line number to start reading from (1-indexed). Use with end_line to read a specific range or continue a large-file preview.',
			},
			end_line: {
				type: 'number',
				description:
					'Optional: Line number to stop reading at (inclusive). Use with start_line to read a specific range or continue a large-file preview.',
			},
			metadata_only: {
				type: 'boolean',
				description:
					'Optional: If true, returns only file metadata (size, line count, type, encoding, modification time) without content. Useful for quickly checking file properties.',
			},
		},
		required: ['path'],
	}),
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
			readEndLine: number;
			tokens: number;
			isPartialRead: boolean;
			isMetadataOnly: boolean;
			isTruncated: boolean;
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
								{args.start_line || 1} - {args.end_line || fileInfo.readEndLine}
								{fileInfo.isTruncated ? ` of ${fileInfo.totalLines}` : ''}
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

	// `metadata_only` is the flag that selects the metadata response shape in
	// executeReadFile, so it's the only correct signal here too. Boolean()
	// matches executeReadFile's truthy `if (args.metadata_only)` rather than
	// `=== true`: the XML tool-call fallback can hand this through as the
	// string 'true', which is truthy but not strictly equal to true.
	const isMetadataOnly = Boolean(args.metadata_only);

	// Set isMetadataOnly from the args flag up front, not derived from what
	// follows: for a directory or symlink, executeReadFile's metadata branch
	// never calls getCachedFileContent, so the same call below throws
	// (EISDIR) and lands in the catch. Seeding the default fileInfo with the
	// real flag means that still renders the metadata layout, just with
	// totalLines left at 0, instead of falling back to the content layout.
	let fileInfo = {
		totalLines: 0,
		readLines: 0,
		readEndLine: 0,
		tokens: 0,
		isPartialRead: false,
		isMetadataOnly,
		isTruncated: false,
	};

	try {
		const path = args.path || args.file_path;
		if (path && typeof path === 'string') {
			const absPath = resolve(getSafeSessionCwd(), path);
			const cached = await getCachedFileContent(absPath);
			const lines = cached.lines;
			const totalLines = lines.length;

			const isTruncated = result?.includes('[Truncated at line ') ?? false;

			// Calculate what was actually read
			const startLine = args.start_line || 1;
			const readEndLine = isTruncated
				? Math.min(FILE_READ_PREVIEW_LINES, totalLines)
				: args.end_line || totalLines;
			const readLines = readEndLine - startLine + 1;
			const isPartialRead = startLine > 1 || readEndLine < totalLines;

			// Tokens are only rendered for content reads (see
			// ReadFileFormatter below), so skip calculating them for a
			// metadata-only read - the value would never be shown.
			const tokens = isMetadataOnly ? 0 : result ? calculateTokens(result) : 0;

			fileInfo = {
				totalLines,
				readLines,
				readEndLine,
				tokens,
				isPartialRead,
				isMetadataOnly,
				isTruncated,
			};
		}
	} catch {
		// File doesn't exist, or is a directory/symlink that the metadata
		// branch handles without reading content - keep the default
		// fileInfo, which already carries the correct isMetadataOnly.
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
	const cwd = getSafeSessionCwd();
	const root = getProjectRoot();
	if (!isValidFilePath(args.path, root)) {
		return {
			valid: false,
			error: `Invalid file path: "${args.path}". Path must be within the project directory.`,
		};
	}

	// Verify the resolved path stays within project boundaries
	try {
		resolveFilePath(args.path, cwd, root);
	} catch (error) {
		const errorMessage = formatError(error);
		return {
			valid: false,
			error: `Path validation failed: ${errorMessage}`,
		};
	}

	const absPath = resolve(getSafeSessionCwd(), args.path);

	try {
		await access(absPath, constants.F_OK);

		// Validate line range parameters
		if (args.start_line !== undefined && args.start_line < 1) {
			return {
				valid: false,
				error: 'start_line must be >= 1',
			};
		}

		if (
			args.start_line !== undefined &&
			args.end_line !== undefined &&
			args.end_line < args.start_line
		) {
			return {
				valid: false,
				error: 'end_line must be >= start_line',
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
						error: `File "${args.path}" contains minified or binary content (line ${i + 1} has ${line.length} characters). This file cannot be read as it would consume excessive tokens without providing useful information.`,
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
				error: `File "${args.path}" does not exist`,
			};
		}
		const errorMessage = formatError(error);
		return {
			valid: false,
			error: `Cannot access file "${args.path}": ${errorMessage}`,
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
