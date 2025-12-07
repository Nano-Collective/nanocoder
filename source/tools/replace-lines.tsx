import React from 'react';
import {resolve} from 'node:path';
import {readFile, writeFile, access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {highlight} from 'cli-highlight';
import {Text, Box} from 'ink';

import {tool, jsonSchema} from '@/types/core';
import {getColors} from '@/config/index';
import {getLanguageFromExtension} from '@/utils/programming-language-helper';
import ToolMessage from '@/components/tool-message';
import {
	isVSCodeConnected,
	sendFileChangeToVSCode,
	closeDiffInVSCode,
} from '@/vscode/index';
import {getCurrentMode} from '@/context/mode-context';

interface ReplaceLinesArgs {
	path: string;
	line_number: number;
	end_line?: number;
	content: string;
}

const executeReplaceLines = async (args: ReplaceLinesArgs): Promise<string> => {
	const {path, line_number, end_line, content} = args;

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
	const fileContent = await readFile(absPath, 'utf-8');
	const lines = fileContent.split('\n');

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

	// Replace lines
	const replaceLines = content.split('\n');
	const linesToRemove = endLine - line_number + 1;
	const newLines = [...lines];
	newLines.splice(line_number - 1, linesToRemove, ...replaceLines);

	// Build the new content
	const newContent = newLines.join('\n');

	// Write updated content
	await writeFile(absPath, newContent, 'utf-8');

	// Generate full file contents to show the model the current file state
	let fileContext = '\n\nUpdated file contents:\n';
	for (let i = 0; i < newLines.length; i++) {
		const lineNumStr = String(i + 1).padStart(4, ' ');
		const line = newLines[i] || '';
		fileContext += `${lineNumStr}: ${line}\n`;
	}

	const rangeDesc =
		line_number === endLine
			? `line ${line_number}`
			: `lines ${line_number}-${endLine}`;
	return `Successfully replaced ${rangeDesc} with ${replaceLines.length} line${
		replaceLines.length > 1 ? 's' : ''
	}.${fileContext}`;
};

const replaceLinesCoreTool = tool({
	description:
		'Replace lines in a file (single line or range) with new content',
	inputSchema: jsonSchema<ReplaceLinesArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The path to the file to edit.',
			},
			line_number: {
				type: 'number',
				description: 'The starting line number (1-based) to replace.',
			},
			end_line: {
				type: 'number',
				description:
					'The ending line number (1-based) to replace. If omitted, only line_number is replaced.',
			},
			content: {
				type: 'string',
				description:
					'The replacement content. Can contain multiple lines separated by \\n.',
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
		return await executeReplaceLines(args);
	},
});

const ReplaceLinesFormatter = React.memo(
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
	diffRemoved: string;
	diffRemovedText: string;
}

async function formatReplaceLinesPreview(
	args: ReplaceLinesArgs,
	result?: string,
	colors?: ThemeColors,
): Promise<React.ReactElement> {
	const themeColors = colors || (getColors() as ThemeColors);
	const {path, line_number, end_line, content} = args;
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
		const fileContent = await readFile(resolve(path), 'utf-8');
		const lines = fileContent.split('\n');
		const ext = String(path).split('.').pop()?.toLowerCase();
		const language = getLanguageFromExtension(ext ?? '');

		// For results, show the actual file state after replacement
		if (isResult) {
			const replaceLines = String(content).split('\n');
			const contextLines = 5;
			const showStart = Math.max(0, lineNumber - 1 - contextLines);
			const showEnd = Math.min(
				lines.length - 1,
				lineNumber - 1 + replaceLines.length + contextLines,
			);

			const contextElements: React.ReactElement[] = [];

			for (let i = showStart; i <= showEnd; i++) {
				const lineNumStr = String(i + 1).padStart(4, ' ');
				const line = lines[i] || '';
				const isReplacedLine =
					i + 1 >= lineNumber && i + 1 < lineNumber + replaceLines.length;

				let displayLine: string;
				try {
					displayLine = highlight(line, {language, theme: 'default'});
				} catch {
					displayLine = line;
				}

				if (isReplacedLine) {
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

			const rangeDesc =
				lineNumber === endLine
					? `line ${lineNumber}`
					: `lines ${lineNumber}-${endLine}`;
			const messageContent = (
				<Box flexDirection="column">
					<Text color={themeColors.tool}>{displayTitle} replace_lines</Text>

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
							✓ Replace completed successfully
						</Text>
					</Box>

					<Box flexDirection="column" marginTop={1}>
						<Text color={themeColors.secondary}>
							Context around replacement:
						</Text>
						{contextElements}
					</Box>
				</Box>
			);

			return <ToolMessage message={messageContent} hideBox={true} />;
		}

		// Preview mode - show what will be replaced
		if (lineNumber > lines.length || endLine > lines.length) {
			const maxLine = Math.max(lineNumber, endLine);
			throw new Error(
				`Line ${maxLine} is out of range (file has ${lines.length} lines)`,
			);
		}

		const replaceLines = String(content).split('\n');
		const linesToRemove = endLine - lineNumber + 1;
		const contextLines = 3;
		const showStart = Math.max(0, lineNumber - 1 - contextLines);
		const showEnd = Math.min(lines.length - 1, endLine - 1 + contextLines);

		const contextBefore: React.ReactElement[] = [];
		const removedLines: React.ReactElement[] = [];
		const addedLines: React.ReactElement[] = [];
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

		// Show removed lines
		for (let i = lineNumber - 1; i < endLine; i++) {
			const lineNumStr = String(i + 1).padStart(4, ' ');
			const line = lines[i] || '';
			let displayLine: string;
			try {
				displayLine = highlight(line, {language, theme: 'default'});
			} catch {
				displayLine = line;
			}

			removedLines.push(
				<Text
					key={`remove-${i}`}
					backgroundColor={themeColors.diffRemoved}
					color={themeColors.diffRemovedText}
					wrap="wrap"
				>
					{lineNumStr} - {displayLine}
				</Text>,
			);
		}

		// Show added lines
		for (let i = 0; i < replaceLines.length; i++) {
			const lineNumStr = String(lineNumber + i).padStart(4, ' ');
			const line = String(replaceLines[i] ?? '');
			let displayLine: string;
			try {
				displayLine = highlight(line, {language, theme: 'default'});
			} catch {
				displayLine = line;
			}

			addedLines.push(
				<Text
					key={`add-${i}`}
					backgroundColor={themeColors.diffAdded}
					color={themeColors.diffAddedText}
					wrap="wrap"
				>
					{lineNumStr} + {displayLine}
				</Text>,
			);
		}

		// Show context after
		for (let i = endLine; i <= showEnd; i++) {
			const lineNumStr = String(
				i + replaceLines.length - linesToRemove + 1,
			).padStart(4, ' ');
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
				<Text color={themeColors.tool}>{displayTitle} replace_lines</Text>

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
						✓ Replacing {linesToRemove} line{linesToRemove > 1 ? 's' : ''} with{' '}
						{replaceLines.length} line{replaceLines.length > 1 ? 's' : ''}
					</Text>
					<Box flexDirection="column">
						{contextBefore}
						{removedLines}
						{addedLines}
						{contextAfter}
					</Box>
				</Box>
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	} catch (error) {
		const errorContent = (
			<Box flexDirection="column">
				<Text color={themeColors.tool}>⚒ replace_lines</Text>

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

const replaceLinesFormatter = async (
	args: ReplaceLinesArgs,
	result?: string,
): Promise<React.ReactElement> => {
	const colors = getColors() as ThemeColors;
	const {path} = args;
	const absPath = resolve(path);

	// Send diff to VS Code during preview phase (before execution)
	// Only send when result is undefined (preview mode, not after execution)
	if (result === undefined && isVSCodeConnected()) {
		const {line_number, end_line, content} = args;
		try {
			const fileContent = await readFile(absPath, 'utf-8');
			const lines = fileContent.split('\n');
			const lineNumber = Number(line_number);
			const endLine = Number(end_line) || lineNumber;

			// Build new content for diff preview
			const replaceLines = content.split('\n');
			const linesToRemove = endLine - lineNumber + 1;
			const newLines = [...lines];
			newLines.splice(lineNumber - 1, linesToRemove, ...replaceLines);
			const newContent = newLines.join('\n');

			const changeId = sendFileChangeToVSCode(
				absPath,
				fileContent,
				newContent,
				'replace_lines',
				{
					path,
					line_number,
					end_line: endLine,
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

	const preview = await formatReplaceLinesPreview(args, result, colors);
	return <ReplaceLinesFormatter preview={preview} />;
};

const replaceLinesValidator = async (
	args: ReplaceLinesArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const {path, line_number, end_line} = args;

	// Check if file exists
	const absPath = resolve(path);
	try {
		await access(absPath, constants.F_OK);
	} catch (error: unknown) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code === 'ENOENT') {
			return {
				valid: false,
				error: `⚒ File "${path}" does not exist`,
			};
		}
		return {
			valid: false,
			error: `⚒ Cannot access file "${path}": ${
				nodeError.message ?? String(error)
			}`,
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
		const fileContent = await readFile(absPath, 'utf-8');
		const lines = fileContent.split('\n');

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
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			valid: false,
			error: `⚒ Error reading file: ${errorMessage}`,
		};
	}

	return {valid: true};
};

export const replaceLinesTool = {
	name: 'replace_lines' as const,
	tool: replaceLinesCoreTool,
	formatter: replaceLinesFormatter,
	validator: replaceLinesValidator,
};
