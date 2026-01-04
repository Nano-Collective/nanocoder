import {constants, existsSync} from 'node:fs';
import {access, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {highlight} from 'cli-highlight';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {
	FILE_READ_METADATA_THRESHOLD_LINES,
	FILE_WRITE_PREVIEW_LINES,
} from '@/constants';
import {getCurrentMode} from '@/context/mode-context';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {calculateChangeStatistics} from '@/utils/change-calculator';
import {getCachedFileContent, invalidateCache} from '@/utils/file-cache';
import {getFileType} from '@/utils/file-type-detector';
import {normalizeIndentation} from '@/utils/indentation-normalizer';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';
import {getLanguageFromExtension} from '@/utils/programming-language-helper';
import {calculateTokens} from '@/utils/token-calculator';
import {
	closeDiffInVSCode,
	isVSCodeConnected,
	sendFileChangeToVSCode,
} from '@/vscode/index';

const executeWriteFile = async (args: {
	path: string;
	content: string;
}): Promise<string> => {
	const absPath = resolve(args.path);
	const fileExists = existsSync(absPath);
	const fileType = getFileType(absPath);

	// Calculate change statistics for overwrites
	let changeStats = null;
	let oldContent = '';
	if (fileExists) {
		try {
			const cached = await getCachedFileContent(absPath);
			oldContent = cached.content;
			changeStats = calculateChangeStatistics(oldContent, args.content);
		} catch {
			// File exists but couldn't read - proceed with write
		}
	}

	await writeFile(absPath, args.content, 'utf-8');

	// Invalidate cache after write
	invalidateCache(absPath);

	// Read back to verify
	const actualContent = await readFile(absPath, 'utf-8');
	const lines = actualContent.split('\n');
	const lineCount = actualContent.length === 0 ? 0 : lines.length;
	const fileSize = actualContent.length;
	const estimatedTokens = calculateTokens(actualContent);

	// Determine if file is large and needs progressive disclosure
	const isLargeFile = lineCount > FILE_READ_METADATA_THRESHOLD_LINES;

	// Build response with file type and change statistics
	let output = '';
	output += `File: ${args.path}\n`;
	output += `Type: ${fileType}\n`;
	output += `Lines: ${lineCount.toLocaleString()}\n`;
	output += `Size: ${fileSize.toLocaleString()} bytes\n`;
	output += `Estimated tokens: ~${estimatedTokens.toLocaleString()}\n`;

	if (fileExists && changeStats) {
		const action =
			changeStats.changeType === 'replace'
				? 'replaced'
				: changeStats.changeType === 'insert'
					? 'appended to'
					: 'overwritten';
		output += `Action: File ${action} (`;
		if (changeStats.changeType === 'replace') {
			output += `-${changeStats.linesRemoved} lines, +${changeStats.linesAdded} lines, `;
		}
		output += `~${changeStats.netTokenChange >= 0 ? '+' : ''}${changeStats.netTokenChange.toLocaleString()} tokens)\n`;
	} else {
		output += `Action: New file created\n`;
	}

	// Progressive disclosure for large files
	if (isLargeFile) {
		output += `\n[Large file (${lineCount} lines) - Showing preview of first ${FILE_WRITE_PREVIEW_LINES} lines]\n`;
		const previewLines = lines.slice(0, FILE_WRITE_PREVIEW_LINES);
		for (let i = 0; i < previewLines.length; i++) {
			const lineNumStr = String(i + 1).padStart(4, ' ');
			output += `${lineNumStr}: ${previewLines[i] || ''}\n`;
		}
		if (lineCount > FILE_WRITE_PREVIEW_LINES) {
			output += `... and ${lineCount - FILE_WRITE_PREVIEW_LINES} more lines\n`;
		}
	} else {
		// Show full content for small files
		output += `\nFile contents:\n`;
		for (let i = 0; i < lines.length; i++) {
			const lineNumStr = String(i + 1).padStart(4, ' ');
			const line = lines[i] || '';
			output += `${lineNumStr}: ${line}\n`;
		}
	}

	return output.trimEnd();
};

const writeFileCoreTool = tool({
	description:
		'Write content to a file (creates new file or overwrites existing file). Use this for complete file rewrites, generated code, or when most of the file needs to change. For small targeted edits, use string_replace instead.',
	inputSchema: jsonSchema<{path: string; content: string}>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The path to the file to write.',
			},
			content: {
				type: 'string',
				description: 'The complete content to write to the file.',
			},
		},
		required: ['path', 'content'],
	}),
	// Medium risk: file write operation, requires approval except in auto-accept mode
	needsApproval: () => {
		const mode = getCurrentMode();
		return mode !== 'auto-accept'; // true in normal/plan, false in auto-accept
	},
	execute: async (args, _options) => {
		return await executeWriteFile(args);
	},
});

interface WriteFileArgs {
	path?: string;
	file_path?: string;
	content?: string;
}

// Create a component that will re-render when theme changes
const WriteFileFormatter = React.memo(({args}: {args: WriteFileArgs}) => {
	const themeContext = React.useContext(ThemeContext);
	if (!themeContext) {
		throw new Error('ThemeContext is required');
	}
	const {colors} = themeContext;
	const path = args.path || args.file_path || 'unknown';
	const newContent = args.content || '';
	const fileType = getFileType(path);
	const lineCount = newContent.split('\n').length;
	const charCount = newContent.length;
	const estimatedTokens = calculateTokens(newContent);

	// Normalize indentation for display
	const lines = newContent.split('\n');
	const normalizedLines = normalizeIndentation(lines);

	// Progressive disclosure for large files
	const isLargeFile = lineCount > FILE_READ_METADATA_THRESHOLD_LINES;
	const previewLines = normalizedLines.slice(0, FILE_WRITE_PREVIEW_LINES);

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>⚒ write_file</Text>

			<Box>
				<Text color={colors.secondary}>Path: </Text>
				<Text color={colors.text}>{path}</Text>
			</Box>
			<Box>
				<Text color={colors.secondary}>Type: </Text>
				<Text color={colors.text}>{fileType}</Text>
			</Box>
			<Box>
				<Text color={colors.secondary}>Size: </Text>
				<Text color={colors.text}>
					{lineCount} lines, {charCount} characters (~{estimatedTokens} tokens)
				</Text>
			</Box>

			{newContent.length > 0 ? (
				<Box flexDirection="column" marginTop={1}>
					<Text color={colors.text}>
						File content:
						{isLargeFile
							? ` (preview - ${FILE_WRITE_PREVIEW_LINES}/${lineCount} lines)`
							: ''}
					</Text>
					{previewLines.map((line: string, i: number) => {
						const lineNumStr = String(i + 1).padStart(4, ' ');
						const ext = path.split('.').pop()?.toLowerCase() ?? '';
						const language = getLanguageFromExtension(ext);

						try {
							const highlighted = highlight(line, {language, theme: 'default'});
							return (
								<Box key={i}>
									<Text color={colors.secondary}>{lineNumStr} </Text>
									<Text wrap="wrap">{highlighted}</Text>
								</Box>
							);
						} catch {
							return (
								<Box key={i}>
									<Text color={colors.secondary}>{lineNumStr} </Text>
									<Text wrap="wrap">{line}</Text>
								</Box>
							);
						}
					})}
					{isLargeFile && lineCount > FILE_WRITE_PREVIEW_LINES && (
						<Box>
							<Text color={colors.secondary}>
								... and {lineCount - FILE_WRITE_PREVIEW_LINES} more lines
							</Text>
						</Box>
					)}
				</Box>
			) : (
				<Box marginTop={1}>
					<Text color={colors.secondary}>File will be empty</Text>
				</Box>
			)}
		</Box>
	);

	return <ToolMessage message={messageContent} hideBox={true} />;
});

// Track VS Code change IDs for cleanup
const vscodeChangeIds = new Map<string, string>();

const writeFileFormatter = async (
	args: WriteFileArgs,
	result?: string,
): Promise<React.ReactElement> => {
	const path = args.path || args.file_path || '';
	const absPath = resolve(path);

	// Send diff to VS Code during preview phase (before execution)
	if (result === undefined && isVSCodeConnected()) {
		const content = args.content || '';
		const fileType = getFileType(absPath);

		// Get original content if file exists (use cache if available)
		let originalContent = '';
		if (existsSync(absPath)) {
			try {
				const cached = await getCachedFileContent(absPath);
				originalContent = cached.content;
			} catch {
				// File might exist but not be readable
			}
		}

		// Calculate change statistics for overwrites
		let changeStats = null;
		if (originalContent) {
			try {
				changeStats = calculateChangeStatistics(originalContent, content);
			} catch {
				// Ignore calculation errors
			}
		}

		// Send enhanced metadata to VS Code
		const changeId = sendFileChangeToVSCode(
			absPath,
			originalContent,
			content,
			'write_file',
			{
				path,
				content,
				fileType,
				newFile: !originalContent,
				lineCount: content.split('\n').length,
				changeStats,
			},
		);
		if (changeId) {
			vscodeChangeIds.set(absPath, changeId);
		}
	} else if (result !== undefined && isVSCodeConnected()) {
		// Tool was executed (confirmed or rejected), close the diff
		const changeId = vscodeChangeIds.get(absPath);
		if (changeId) {
			closeDiffInVSCode(changeId);
			vscodeChangeIds.delete(absPath);
		}
	}

	return <WriteFileFormatter args={args} />;
};

const writeFileValidator = async (args: {
	path: string;
	content: string;
}): Promise<{valid: true} | {valid: false; error: string}> => {
	// Validate path boundary first to prevent directory traversal
	if (!isValidFilePath(args.path)) {
		return {
			valid: false,
			error: `Invalid file path: "${args.path}". Path must be relative and within the project directory.`,
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
			error: `Path validation failed: ${errorMessage}`,
		};
	}

	const absPath = resolve(args.path);

	// Check if parent directory exists
	const parentDir = dirname(absPath);
	try {
		await access(parentDir, constants.F_OK);
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error) {
			if (error.code === 'ENOENT') {
				return {
					valid: false,
					error: `Parent directory does not exist: "${parentDir}"`,
				};
			}
		}
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		return {
			valid: false,
			error: `Cannot access parent directory "${parentDir}": ${errorMessage}`,
		};
	}

	// Check for invalid path characters or attempts to write to system directories
	const invalidPatterns = [
		/^\/etc\//i,
		/^\/sys\//i,
		/^\/proc\//i,
		/^\/dev\//i,
		/^\/boot\//i,
		/^C:\\Windows\\/i,
		/^C:\\Program Files\\/i,
	];

	for (const pattern of invalidPatterns) {
		if (pattern.test(absPath)) {
			return {
				valid: false,
				error: `Cannot write files to system directory: "${args.path}"`,
			};
		}
	}

	return {valid: true};
};

export const writeFileTool: NanocoderToolExport = {
	name: 'write_file' as const,
	tool: writeFileCoreTool,
	formatter: writeFileFormatter,
	validator: writeFileValidator,
};

export {executeWriteFile, WriteFileFormatter, writeFileValidator};
