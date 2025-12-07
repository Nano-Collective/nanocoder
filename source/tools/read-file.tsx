import {resolve} from 'node:path';
import {readFile, access} from 'node:fs/promises';
import {constants} from 'node:fs';
import React from 'react';
import {Text, Box} from 'ink';
import {tool, jsonSchema} from '@/types/core';
import type {NanocoderToolExport} from '@/types/core';
import {ThemeContext} from '@/hooks/useTheme';
import ToolMessage from '@/components/tool-message';

const executeReadFile = async (args: {
	path: string;
	start_line?: number;
	end_line?: number;
}): Promise<string> => {
	const absPath = resolve(args.path);

	try {
		const content = await readFile(absPath, 'utf-8');

		// Check if file is empty (0 tokens)
		if (content.length === 0) {
			throw new Error(`File "${args.path}" exists but is empty (0 tokens)`);
		}

		const lines = content.split('\n');
		const totalLines = lines.length;
		const fileSize = content.length;
		const estimatedTokens = Math.ceil(fileSize / 4);

		// Progressive disclosure: metadata first for files >300 lines
		// Small files can be read directly without ranges
		if (
			args.start_line === undefined &&
			args.end_line === undefined &&
			totalLines > 300
		) {
			// Return metadata only for medium/large files
			// Detect file type from extension
			const ext = absPath.split('.').pop() || '';
			const typeMap: Record<string, string> = {
				ts: 'TypeScript',
				tsx: 'TypeScript React',
				js: 'JavaScript',
				jsx: 'JavaScript React',
				py: 'Python',
				go: 'Go',
				rs: 'Rust',
				java: 'Java',
				cpp: 'C++',
				c: 'C',
				md: 'Markdown',
				json: 'JSON',
				yaml: 'YAML',
				yml: 'YAML',
				toml: 'TOML',
				html: 'HTML',
				css: 'CSS',
				scss: 'SCSS',
				sh: 'Shell',
				bash: 'Bash',
			};
			const fileType = typeMap[ext] || ext.toUpperCase();

			let output = `File: ${args.path}\n`;
			output += `Type: ${fileType}\n`;
			output += `Total lines: ${totalLines.toLocaleString()}\n`;
			output += `Size: ${fileSize.toLocaleString()} bytes\n`;
			output += `Estimated tokens: ~${estimatedTokens.toLocaleString()}\n\n`;

			if (totalLines <= 500) {
				output += `[Medium file - To read specific sections, call read_file with start_line and end_line]\n`;
				output += `[To read entire file progressively, make multiple calls:]\n`;
				output += `  - read_file({path: "${args.path}", start_line: 1, end_line: 250})\n`;
				output += `  - read_file({path: "${args.path}", start_line: 251, end_line: ${totalLines}})\n`;
			} else {
				output += `[Large file - Choose one approach:]\n`;
				output += `[1. Targeted read: Use search_files to find code, then read specific ranges]\n`;
				output += `[2. Progressive read: Read file in chunks (recommended chunk size: 200-300 lines)]\n`;
				output += `   Example chunks for ${totalLines} lines:\n`;
				const chunkSize = 250;
				const numChunks = Math.ceil(totalLines / chunkSize);
				for (let i = 0; i < Math.min(numChunks, 3); i++) {
					const start = i * chunkSize + 1;
					const end = Math.min((i + 1) * chunkSize, totalLines);
					output += `   - read_file({path: "${args.path}", start_line: ${start}, end_line: ${end}})\n`;
				}
				if (numChunks > 3) {
					output += `   ... and ${
						numChunks - 3
					} more chunks to complete the file\n`;
				}
			}

			return output;
		}

		// Line ranges specified - read and return content
		const startLine = args.start_line ? Math.max(1, args.start_line) : 1;
		const endLine = args.end_line
			? Math.min(totalLines, args.end_line)
			: totalLines;

		// Return content with line numbers for precise editing
		let result = '';
		for (let i = startLine - 1; i < endLine; i++) {
			const lineNum = String(i + 1).padStart(4, ' ');
			result += `${lineNum}: ${lines[i]}\n`;
		}

		return result.slice(0, -1); // Remove trailing newline
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
		'Read file contents with line numbers. PROGRESSIVE DISCLOSURE: First call without line ranges returns metadata (size, lines, tokens). For files >300 lines, you MUST call again with start_line/end_line to read content. Small files (<300 lines) return content directly.',
	inputSchema: jsonSchema<{
		path: string;
		start_line?: number;
		end_line?: number;
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
		},
		required: ['path'],
	}),
	// Low risk: read-only operation, never requires approval
	needsApproval: false,
	execute: async (args, _options) => {
		return await executeReadFile(args);
	},
});

// Create a component that will re-render when theme changes
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
					<Text color={colors.white}>
						{path}{' '}
						{fileInfo.isMetadataOnly && (
							<Text color={colors.info}>(metadata only)</Text>
						)}
					</Text>
				</Box>

				{fileInfo.isMetadataOnly ? (
					<>
						<Box>
							<Text color={colors.secondary}>Total lines: </Text>
							<Text color={colors.white}>
								{fileInfo.totalLines.toLocaleString()}
							</Text>
						</Box>
					</>
				) : (
					<>
						<Box>
							<Text color={colors.secondary}>Lines: </Text>
							<Text color={colors.white}>
								{args.start_line || 1} - {args.end_line || fileInfo.totalLines}
							</Text>
						</Box>

						<Box>
							<Text color={colors.secondary}>Tokens: </Text>
							<Text color={colors.white}>
								~{fileInfo.tokens.toLocaleString()}
							</Text>
						</Box>
					</>
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
			await access(resolve(path), constants.F_OK);
			const content = await readFile(resolve(path), 'utf-8');
			const lines = content.split('\n');
			const totalLines = lines.length;

			// Detect if this was a metadata-only response
			const isMetadataOnly =
				(result?.startsWith('File:') ?? false) &&
				!args.start_line &&
				!args.end_line &&
				totalLines > 300;

			// Calculate what was actually read
			const startLine = args.start_line || 1;
			const endLine = args.end_line || totalLines;
			const readLines = endLine - startLine + 1;
			const isPartialRead = startLine > 1 || endLine < totalLines;

			// Calculate tokens
			let tokens: number;
			if (isMetadataOnly) {
				// For metadata, show estimated tokens of the FULL FILE
				tokens = Math.ceil(content.length / 4);
			} else {
				// For content reads, show tokens of what was actually returned
				tokens = result ? Math.ceil(result.length / 4) : 0;
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
}): Promise<{valid: true} | {valid: false; error: string}> => {
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

		// Check if end_line exceeds file length
		if (args.end_line !== undefined) {
			const content = await readFile(absPath, 'utf-8');
			const totalLines = content.split('\n').length;

			if (args.end_line > totalLines) {
				return {
					valid: false,
					error: `⚒ end_line (${args.end_line}) exceeds file length (${totalLines} lines)`,
				};
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
};
