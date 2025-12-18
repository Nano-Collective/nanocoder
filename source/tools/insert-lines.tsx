import {constants} from 'node:fs';
import {access, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {highlight} from 'cli-highlight';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {getColors} from '@/config/index';
import {getCurrentMode} from '@/context/mode-context';
import {jsonSchema, tool} from '@/types/core';
import {getCachedFileContent, invalidateCache} from '@/utils/file-cache';
import {getLanguageFromExtension} from '@/utils/programming-language-helper';
import {
	closeDiffInVSCode,
	isVSCodeConnected,
	sendFileChangeToVSCode,
} from '@/vscode/index';

interface InsertLinesArgs {
	path: string;
	line_number: number;
	content: string;
}

const executeInsertLines = async (args: InsertLinesArgs): Promise<string> => {
	const {path, line_number, content} = args;

	// Validate line number
	if (!line_number || line_number < 1) {
		throw new Error(
			`Invalid line_number: ${line_number}. Must be a positive integer.`,
		);
	}

	const absPath = resolve(path);
	const cached = await getCachedFileContent(absPath);
	const lines = cached.lines;

	// Validate line number is within range
	if (line_number > lines.length + 1) {
		throw new Error(
			`Line number ${line_number} is out of range (file has ${lines.length} lines)`,
		);
	}

	// Insert new lines
	const insertLines = content.split('\n');
	const newLines = [...lines];
	newLines.splice(line_number - 1, 0, ...insertLines);

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

	return `Successfully inserted ${insertLines.length} line${
		insertLines.length > 1 ? 's' : ''
	} at line ${line_number}.${fileContext}`;
};

const insertLinesCoreTool = tool({
	description: 'Insert new lines at a specific line number in a file',
	inputSchema: jsonSchema<InsertLinesArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The path to the file to edit.',
			},
			line_number: {
				type: 'number',
				description:
					'The line number (1-based) where content should be inserted.',
			},
			content: {
				type: 'string',
				description:
					'The content to insert. Can contain multiple lines separated by \\n.',
			},
		},
		required: ['path', 'line_number', 'content'],
	}),
	// Medium risk: file write operation, requires approval except in auto-accept mode
	needsApproval: () => {
		const mode = getCurrentMode();
		return mode !== 'auto-accept'; // true in normal/plan, false in auto-accept
	},
	execute: async (args, _options) => {
		return await executeInsertLines(args);
	},
});

const InsertLinesFormatter = React.memo(
	({preview}: {preview: React.ReactElement}) => {
		return preview;
	},
);

interface ThemeColors {
	tool: string;
	secondary: string;
	primary: string;
	white: string;
	success: string;
	error: string;
	diffAdded: string;
	diffAddedText: string;
}

async function formatInsertLinesPreview(
	args: InsertLinesArgs,
	result?: string,
	colors?: ThemeColors,
): Promise<React.ReactElement> {
	const themeColors: ThemeColors = colors || (getColors() as ThemeColors);
	const {path, line_number, content} = args;
	const lineNumber = Number(line_number);

	// Validate line number
	if (!lineNumber || lineNumber < 1) {
		throw new Error(
			`Invalid line_number: ${line_number}. Must be a positive integer.`,
		);
	}

	const isResult = result !== undefined;
	const displayTitle = isResult ? '✓' : '⚒';

	try {
		const absPath = resolve(path);
		const cached = await getCachedFileContent(absPath);
		const lines = cached.lines;
		const ext = (path.split('.').pop() ?? '').toLowerCase();
		const language = getLanguageFromExtension(ext ?? '');

		// For results, show the actual file state after insertion
		if (isResult) {
			const insertLines: string[] = content.split('\n');
			const contextLines = 5;
			const showStart = Math.max(0, lineNumber - 1 - contextLines);
			const showEnd = Math.min(
				lines.length - 1,
				lineNumber - 1 + insertLines.length + contextLines,
			);

			const contextElements: React.ReactElement[] = [];

			for (let i = showStart; i <= showEnd; i++) {
				const lineNumStr = String(i + 1).padStart(4, ' ');
				const line = lines[i] || '';
				const isInsertedLine =
					i + 1 >= lineNumber && i + 1 < lineNumber + insertLines.length;

				let displayLine: string;
				try {
					displayLine = highlight(line, {language, theme: 'default'});
				} catch {
					displayLine = line;
				}

				if (isInsertedLine) {
					contextElements.push(
						<Text
							key={`context-${i}`}
							backgroundColor={themeColors.diffAdded}
							color={themeColors.diffAddedText}
							wrap="wrap"
						>
							{lineNumStr} + {displayLine}
						</Text>,
					);
				} else {
					contextElements.push(
						<Text key={`context-${i}`} color={themeColors.secondary}>
							{lineNumStr} {displayLine}
						</Text>,
					);
				}
			}

			const messageContent = (
				<Box flexDirection="column">
					<Text color={themeColors.tool}>{displayTitle} insert_lines</Text>

					<Box>
						<Text color={themeColors.secondary}>Path: </Text>
						<Text color={themeColors.primary}>{path}</Text>
					</Box>

					<Box>
						<Text color={themeColors.secondary}>Line: </Text>
						<Text color={themeColors.white}>{lineNumber}</Text>
					</Box>

					<Box flexDirection="column" marginTop={1}>
						<Text color={themeColors.success}>
							✓ Insert completed successfully
						</Text>
					</Box>

					<Box flexDirection="column" marginTop={1}>
						<Text color={themeColors.secondary}>Context around insertion:</Text>
						{contextElements}
					</Box>
				</Box>
			);

			return <ToolMessage message={messageContent} hideBox={true} />;
		}

		// Preview mode - show what will be inserted
		if (lineNumber > lines.length + 1) {
			throw new Error(
				`Line number ${lineNumber} is out of range (file has ${lines.length} lines)`,
			);
		}

		const insertLines: string[] = content.split('\n');
		const contextLines = 3;
		const showStart = Math.max(0, lineNumber - 1 - contextLines);
		const showEnd = Math.min(lines.length - 1, lineNumber - 1 + contextLines);

		const contextBefore: React.ReactElement[] = [];
		const insertedLines: React.ReactElement[] = [];
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

		// Show inserted lines
		for (let i = 0; i < insertLines.length; i++) {
			const lineNumStr = String(lineNumber + i).padStart(4, ' ');
			const line: string = insertLines[i] ?? '';
			let displayLine: string;
			try {
				displayLine = highlight(line, {language, theme: 'default'});
			} catch {
				displayLine = line;
			}

			insertedLines.push(
				<Text
					key={`insert-${i}`}
					backgroundColor={themeColors.diffAdded}
					color={themeColors.diffAddedText}
					wrap="wrap"
				>
					{lineNumStr} + {displayLine}
				</Text>,
			);
		}

		// Show context after
		for (let i = lineNumber - 1; i <= showEnd; i++) {
			const lineNumStr = String(i + insertLines.length + 1).padStart(4, ' ');
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

		const messageContent = (
			<Box flexDirection="column">
				<Text color={themeColors.tool}>{displayTitle} insert_lines</Text>

				<Box>
					<Text color={themeColors.secondary}>Path: </Text>
					<Text color={themeColors.primary}>{path}</Text>
				</Box>

				<Box>
					<Text color={themeColors.secondary}>Line: </Text>
					<Text color={themeColors.white}>{lineNumber}</Text>
				</Box>

				<Box flexDirection="column" marginTop={1}>
					<Text color={themeColors.success}>
						✓ Inserting {insertLines.length} line
						{insertLines.length > 1 ? 's' : ''}
					</Text>
					<Box flexDirection="column">
						{contextBefore}
						{insertedLines}
						{contextAfter}
					</Box>
				</Box>
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	} catch (error) {
		const errorContent = (
			<Box flexDirection="column">
				<Text color={themeColors.tool}>⚒ insert_lines</Text>

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

const insertLinesFormatter = async (
	args: InsertLinesArgs,
	result?: string,
): Promise<React.ReactElement> => {
	const colors = getColors() as ThemeColors;
	const {path} = args;
	const absPath = resolve(path);

	// Send diff to VS Code during preview phase (before execution)
	if (result === undefined && isVSCodeConnected()) {
		const {line_number, content} = args;
		try {
			const cached = await getCachedFileContent(absPath);
			const fileContent = cached.content;
			const lines = cached.lines;
			const lineNumber = Number(line_number);

			// Build new content for diff preview
			const insertLines = content.split('\n');
			const newLines = [...lines];
			newLines.splice(lineNumber - 1, 0, ...insertLines);
			const newContent = newLines.join('\n');

			const changeId = sendFileChangeToVSCode(
				absPath,
				fileContent,
				newContent,
				'insert_lines',
				{
					path,
					line_number,
					content,
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

	const preview = await formatInsertLinesPreview(args, result, colors);
	return <InsertLinesFormatter preview={preview} />;
};

const insertLinesValidator = async (
	args: InsertLinesArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const {path, line_number} = args;

	// Check if file exists
	const absPath = resolve(path);
	try {
		await access(absPath, constants.F_OK);
	} catch (error: unknown) {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			return {
				valid: false,
				error: `⚒ File "${path}" does not exist`,
			};
		}
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			valid: false,
			error: `⚒ Cannot access file "${path}": ${errorMessage}`,
		};
	}

	// Validate line number
	if (!line_number || line_number < 1) {
		return {
			valid: false,
			error: `⚒ Invalid line_number: ${line_number}. Must be a positive integer.`,
		};
	}

	// Check line number is within valid range (can be 1 past end for append)
	try {
		const cached = await getCachedFileContent(absPath);
		const lines = cached.lines;

		if (line_number > lines.length + 1) {
			return {
				valid: false,
				error: `⚒ Line number ${line_number} is out of range (file has ${
					lines.length
				} lines, can insert at line ${lines.length + 1})`,
			};
		}
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			valid: false,
			error: `⚒ Error reading file: ${errorMessage}`,
		};
	}

	return {valid: true};
};

export const insertLinesTool = {
	name: 'insert_lines' as const,
	tool: insertLinesCoreTool,
	formatter: insertLinesFormatter,
	validator: insertLinesValidator,
};
