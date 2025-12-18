import {constants} from 'node:fs';
import {access, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import ToolMessage from '@/components/tool-message';
import {getColors} from '@/config/index';
import {getCurrentMode} from '@/context/mode-context';
import {jsonSchema, tool} from '@/types/core';
import type {Colors} from '@/types/index';
import {getCachedFileContent, invalidateCache} from '@/utils/file-cache';
import {getLanguageFromExtension} from '@/utils/programming-language-helper';
import {
	closeDiffInVSCode,
	isVSCodeConnected,
	sendFileChangeToVSCode,
} from '@/vscode/index';
import {highlight} from 'cli-highlight';
import {Box, Text} from 'ink';
import React from 'react';

interface DeleteLinesArgs {
	path: string;
	line_number: number;
	end_line?: number;
}

const executeDeleteLines = async (args: DeleteLinesArgs): Promise<string> => {
	const {path, line_number, end_line} = args;

	// Validate line numbers
	if (!line_number || line_number < 1) {
		throw new Error(
			`Invalid line_number: ${line_number}. Must be a positive integer.`,
		);
	}

	const endLine = end_line ?? line_number;
	if (endLine < line_number) {
		throw new Error(
			`end_line (${endLine}) cannot be less than line_number (${line_number}).`,
		);
	}

	const absPath = resolve(path);
	const cached = await getCachedFileContent(absPath);
	const lines = cached.lines;

	// Validate line range is within file bounds
	if (line_number > lines.length) {
		throw new Error(
			`Line number ${line_number} is out of range (file has ${lines.length} lines)`,
		);
	}
	if (endLine > lines.length) {
		throw new Error(
			`End line ${endLine} is out of range (file has ${lines.length} lines)`,
		);
	}

	// Delete lines
	const linesToRemove = endLine - line_number + 1;
	const newLines = [...lines];
	newLines.splice(line_number - 1, linesToRemove);

	// Build new content
	const newContent = newLines.join('\n');

	// Write updated content
	await writeFile(absPath, newContent, 'utf-8');

	// Invalidate cache after write
	invalidateCache(absPath);

	// Generate full file contents to show the model the current file state
	let fileContext = '\n\nUpdated file contents:\n';
	for (let i = 0; i < newLines.length; i++) {
		const lineNumStr = String(i + 1).padStart(4, ' ');
		const line = newLines[i] || '';
		fileContext += `${lineNumStr}: ${line}\n`;
	}

	// Add a note about the deletion
	fileContext += `\n(Deleted ${linesToRemove} line${
		linesToRemove > 1 ? 's' : ''
	} that were previously at line${linesToRemove > 1 ? 's' : ''} ${line_number}${
		endLine !== line_number ? `-${endLine}` : ''
	})\n`;

	const rangeDesc =
		line_number === endLine
			? `line ${line_number}`
			: `lines ${line_number}-${endLine}`;
	return `Successfully deleted ${rangeDesc}.${fileContext}`;
};

const deleteLinesCoreTool = tool({
	description: 'Delete a line or range of lines from a file',
	inputSchema: jsonSchema<DeleteLinesArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The path to the file to edit.',
			},
			line_number: {
				type: 'number',
				description: 'The starting line number (1-based) to delete.',
			},
			end_line: {
				type: 'number',
				description:
					'The ending line number (1-based) for range deletion. If omitted, only line_number is deleted.',
			},
		},
		required: ['path', 'line_number'],
	}),
	// Medium risk: file write operation, requires approval except in auto-accept mode
	needsApproval: () => {
		const mode = getCurrentMode();
		return mode !== 'auto-accept'; // true in normal/plan, false in auto-accept
	},
	execute: async (args, _options) => {
		return await executeDeleteLines(args);
	},
});

const DeleteLinesFormatter = React.memo(
	({preview}: {preview: React.ReactElement}) => {
		return preview;
	},
);

async function formatDeleteLinesPreview(
	args: DeleteLinesArgs,
	result?: string,
	colors?: Colors,
): Promise<React.ReactElement> {
	const themeColors = colors || getColors();
	const {path, line_number, end_line} = args;
	const lineNumber = Number(line_number);
	const endLine = Number(end_line) || lineNumber;

	// Validate line numbers
	if (!lineNumber || lineNumber < 1) {
		throw new Error(
			`Invalid line_number: ${line_number}. Must be a positive integer.`,
		);
	}
	if (endLine < lineNumber) {
		throw new Error(
			`end_line (${endLine}) cannot be less than line_number (${lineNumber}).`,
		);
	}

	const isResult = result !== undefined;
	const displayTitle = isResult ? '✓' : '⚒';

	try {
		const absPath = resolve(path);
		const cached = await getCachedFileContent(absPath);
		const lines = cached.lines;
		const ext = path.split('.').pop()?.toLowerCase() ?? '';
		const language = getLanguageFromExtension(ext);

		// For results mode, show the same diff format as preview mode
		// but with a completed status message
		if (isResult) {
			// In result mode, we just show the range that was deleted and the surrounding context
			// The file has already been updated, so we show the final state
			const linesToRemove = endLine - lineNumber + 1;
			const contextLines = 3;

			// Since the lines were deleted, we show context around where they used to be
			const showStart = Math.max(0, lineNumber - 1 - contextLines);
			const showEnd = Math.min(lines.length - 1, lineNumber - 1 + contextLines);

			const contextElements: React.ReactElement[] = [];

			// Show context before the deletion point
			for (let i = showStart; i < Math.min(lineNumber - 1, lines.length); i++) {
				const lineNumStr = String(i + 1).padStart(4, ' ');
				const line = lines[i] || '';
				let displayLine: string;
				try {
					displayLine = highlight(line, {language, theme: 'default'});
				} catch {
					displayLine = line;
				}

				contextElements.push(
					<Text key={`before-${i}`} color={themeColors.secondary}>
						{lineNumStr} {displayLine}
					</Text>,
				);
			}

			// Show a marker indicating where the deletion occurred
			const deletionLineNum = lineNumber;
			contextElements.push(
				<Text
					key="deletion-marker"
					backgroundColor={themeColors.diffRemoved}
					color={themeColors.diffRemovedText}
					wrap="wrap"
				>
					{String(deletionLineNum).padStart(4, ' ')} - [Deleted {linesToRemove}{' '}
					line{linesToRemove > 1 ? 's' : ''}]
				</Text>,
			);

			// Show context after the deletion point (adjust line numbers)
			for (
				let i = lineNumber - 1;
				i <= Math.min(showEnd, lines.length - 1);
				i++
			) {
				const displayLineNum = i + linesToRemove + 1;
				const lineNumStr = String(displayLineNum).padStart(4, ' ');
				const line = lines[i] || '';
				let displayLine: string;
				try {
					displayLine = highlight(line, {language, theme: 'default'});
				} catch {
					displayLine = line;
				}

				contextElements.push(
					<Text key={`after-${i}`} color={themeColors.secondary}>
						{lineNumStr} {displayLine}
					</Text>,
				);
			}

			const rangeDesc =
				lineNumber === endLine
					? `line ${lineNumber}`
					: `lines ${lineNumber}-${endLine}`;
			const messageContent = (
				<Box flexDirection="column">
					<Text color={themeColors.tool}>{displayTitle} delete_lines</Text>

					<Box>
						<Text color={themeColors.secondary}>Path: </Text>
						<Text color={themeColors.primary}>{path}</Text>
					</Box>

					<Box>
						<Text color={themeColors.secondary}>Deleted: </Text>
						<Text color={themeColors.white}>{rangeDesc}</Text>
					</Box>

					<Box flexDirection="column" marginTop={1}>
						<Text color={themeColors.success}>
							✓ Delete completed successfully
						</Text>
					</Box>

					<Box flexDirection="column" marginTop={1}>
						<Text color={themeColors.secondary}>Result:</Text>
						{contextElements}
					</Box>
				</Box>
			);

			return <ToolMessage message={messageContent} hideBox={true} />;
		}

		// Preview mode - show what will be deleted
		if (lineNumber > lines.length || endLine > lines.length) {
			const maxLine = Math.max(lineNumber, endLine);
			throw new Error(
				`Line ${maxLine} is out of range (file has ${lines.length} lines)`,
			);
		}

		const linesToRemove = endLine - lineNumber + 1;
		const contextLines = 3;
		const showStart = Math.max(0, lineNumber - 1 - contextLines);
		const showEnd = Math.min(lines.length - 1, endLine - 1 + contextLines);

		const contextBefore: React.ReactElement[] = [];
		const deletedLines: React.ReactElement[] = [];
		const contextAfter: React.ReactElement[] = [];

		// Show context before
		for (let i = showStart; i < lineNumber - 1; i++) {
			const lineNumStr = String(i + 1).padStart(4, ' ');
			const line = lines[i] || '';
			let displayLine: string;
			try {
				displayLine = highlight(line, {language, theme: 'default'});
			} catch {
				displayLine = line;
			}

			contextBefore.push(
				<Text key={`before-${i}`} color={themeColors.secondary}>
					{lineNumStr} {displayLine}
				</Text>,
			);
		}

		// Show deleted lines
		for (let i = lineNumber - 1; i < endLine; i++) {
			const lineNumStr = String(i + 1).padStart(4, ' ');
			const line = lines[i] || '';
			let displayLine: string;
			try {
				displayLine = highlight(line, {language, theme: 'default'});
			} catch {
				displayLine = line;
			}

			deletedLines.push(
				<Text
					key={`delete-${i}`}
					backgroundColor={themeColors.diffRemoved}
					color={themeColors.diffRemovedText}
					wrap="wrap"
				>
					{lineNumStr} - {displayLine}
				</Text>,
			);
		}

		// Show context after
		for (let i = endLine; i <= showEnd; i++) {
			const lineNumStr = String(i - linesToRemove + 1).padStart(4, ' ');
			const line = lines[i] || '';
			let displayLine: string;
			try {
				displayLine = highlight(line, {language, theme: 'default'});
			} catch {
				displayLine = line;
			}

			contextAfter.push(
				<Text key={`after-${i}`} color={themeColors.secondary}>
					{lineNumStr} {displayLine}
				</Text>,
			);
		}

		const rangeDesc =
			lineNumber === endLine
				? `line ${lineNumber}`
				: `lines ${lineNumber}-${endLine}`;
		const messageContent = (
			<Box flexDirection="column">
				<Text color={themeColors.tool}>{displayTitle} delete_lines</Text>

				<Box>
					<Text color={themeColors.secondary}>Path: </Text>
					<Text color={themeColors.primary}>{path}</Text>
				</Box>

				<Box>
					<Text color={themeColors.secondary}>Range: </Text>
					<Text color={themeColors.white}>{rangeDesc}</Text>
				</Box>

				<Box flexDirection="column" marginTop={1}>
					<Text color={themeColors.success}>
						✓ Deleting {linesToRemove} line{linesToRemove > 1 ? 's' : ''}
					</Text>
					<Box flexDirection="column">
						{contextBefore}
						{deletedLines}
						{contextAfter}
					</Box>
				</Box>
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	} catch (error) {
		const errorContent = (
			<Box flexDirection="column">
				<Text color={themeColors.tool}>⚒ delete_lines</Text>

				<Box>
					<Text color={themeColors.secondary}>Path: </Text>
					<Text color={themeColors.primary}>{path}</Text>
				</Box>

				<Box>
					<Text color={themeColors.error}>Error: </Text>
					<Text color={themeColors.error}>
						{error instanceof Error ? error.message : String(error)}
					</Text>
				</Box>
			</Box>
		);

		return <ToolMessage message={errorContent} hideBox={true} />;
	}
}

// Track VS Code change IDs for cleanup
const vscodeChangeIds = new Map<string, string>();

const deleteLinesFormatter = async (
	args: DeleteLinesArgs,
	result?: string,
): Promise<React.ReactElement> => {
	const colors = getColors();
	const {path} = args;
	const absPath = resolve(path);

	// Send diff to VS Code during preview phase (before execution)
	if (result === undefined && isVSCodeConnected()) {
		const {line_number, end_line} = args;
		try {
			const cached = await getCachedFileContent(absPath);
			const fileContent = cached.content;
			const lines = cached.lines;
			const lineNumber = Number(line_number);
			const endLine = Number(end_line) || lineNumber;

			// Build new content for diff preview
			const linesToRemove = endLine - lineNumber + 1;
			const newLines = [...lines];
			newLines.splice(lineNumber - 1, linesToRemove);
			const newContent = newLines.join('\n');

			const changeId = sendFileChangeToVSCode(
				absPath,
				fileContent,
				newContent,
				'delete_lines',
				{
					path,
					line_number,
					end_line: endLine,
				},
			);
			if (changeId) {
				vscodeChangeIds.set(absPath, changeId);
			}
		} catch {
			// Silently ignore errors sending to VS Code
		}
	} else if (result !== undefined && isVSCodeConnected()) {
		// Tool was executed (confirmed or rejected), close the diff
		const changeId = vscodeChangeIds.get(absPath);
		if (changeId) {
			closeDiffInVSCode(changeId);
			vscodeChangeIds.delete(absPath);
		}
	}

	const preview = await formatDeleteLinesPreview(args, result, colors);
	return <DeleteLinesFormatter preview={preview} />;
};

const deleteLinesValidator = async (
	args: DeleteLinesArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const {path, line_number, end_line} = args;

	// Check if file exists
	const absPath = resolve(path);
	try {
		await access(absPath, constants.F_OK);
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error) {
			if (error.code === 'ENOENT') {
				return {
					valid: false,
					error: `⚒ File "${path}" does not exist`,
				};
			}
		}
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			valid: false,
			error: `⚒ Cannot access file "${path}": ${errorMessage}`,
		};
	}

	// Validate line numbers
	if (!line_number || line_number < 1) {
		return {
			valid: false,
			error: `⚒ Invalid line_number: ${line_number}. Must be a positive integer.`,
		};
	}

	const endLine = end_line ?? line_number;
	if (endLine < line_number) {
		return {
			valid: false,
			error: `⚒ end_line (${endLine}) cannot be less than line_number (${line_number}).`,
		};
	}

	// Check line numbers are within file bounds
	try {
		const cached = await getCachedFileContent(absPath);
		const lines = cached.lines;

		if (line_number > lines.length) {
			return {
				valid: false,
				error: `⚒ Line number ${line_number} is out of range (file has ${lines.length} lines)`,
			};
		}

		if (endLine > lines.length) {
			return {
				valid: false,
				error: `⚒ End line ${endLine} is out of range (file has ${lines.length} lines)`,
			};
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			valid: false,
			error: `⚒ Error reading file: ${errorMessage}`,
		};
	}

	return {valid: true};
};

export const deleteLinesTool = {
	name: 'delete_lines' as const,
	tool: deleteLinesCoreTool,
	formatter: deleteLinesFormatter,
	validator: deleteLinesValidator,
};
