import {constants} from 'node:fs';
import {access, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {highlight} from 'cli-highlight';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {getColors} from '@/config/index';
import {isNanocoderToolAlwaysAllowed} from '@/config/nanocoder-tools-config';
import {getCurrentMode} from '@/context/mode-context';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import type {Colors} from '@/types/index';
import {getCachedFileContent, invalidateCache} from '@/utils/file-cache';
import {normalizeIndentation} from '@/utils/indentation-normalizer';
import {areLinesSimlar, computeInlineDiff} from '@/utils/inline-diff';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';
import {getLanguageFromExtension} from '@/utils/programming-language-helper';
import {
	closeDiffInVSCode,
	isVSCodeConnected,
	sendFileChangeToVSCode,
} from '@/vscode/index';

interface StringReplaceArgs {
	path: string;
	old_str: string;
	new_str: string;
}

const executeStringReplace = async (
	args: StringReplaceArgs,
): Promise<string> => {
	const {path, old_str, new_str} = args;

	// Validate old_str is not empty
	if (!old_str || old_str.length === 0) {
		throw new Error(
			'old_str cannot be empty. Provide the exact content to find and replace.',
		);
	}

	const absPath = resolve(path);
	const cached = await getCachedFileContent(absPath);
	const fileContent = cached.content;

	// Count occurrences of old_str
	const occurrences = fileContent.split(old_str).length - 1;

	if (occurrences === 0) {
		throw new Error(
			`Content not found in file. The file may have changed since you last read it.\n\nSearching for:\n${old_str}\n\nSuggestion: Read the file again to see current contents.`,
		);
	}

	if (occurrences > 1) {
		throw new Error(
			`Found ${occurrences} matches for the search string. Please provide more surrounding context to make the match unique.\n\nSearching for:\n${old_str}`,
		);
	}

	// Perform the replacement
	const newContent = fileContent.replace(old_str, new_str);

	// Write updated content
	await writeFile(absPath, newContent, 'utf-8');

	// Invalidate cache after write
	invalidateCache(absPath);

	// Calculate line numbers where change occurred
	const beforeLines = fileContent.split('\n');
	const oldStrLines = old_str.split('\n');
	const newStrLines = new_str.split('\n');

	// Find the line where the change started
	let startLine = 0;
	let searchIndex = 0;
	for (let i = 0; i < beforeLines.length; i++) {
		const lineWithNewline =
			beforeLines[i] + (i < beforeLines.length - 1 ? '\n' : '');
		if (fileContent.indexOf(old_str, searchIndex) === searchIndex) {
			startLine = i + 1;
			break;
		}
		searchIndex += lineWithNewline.length;
	}

	const endLine = startLine + oldStrLines.length - 1;
	const newEndLine = startLine + newStrLines.length - 1;

	// Generate full file contents to show the model the current file state
	const newLines = newContent.split('\n');
	let fileContext = '\n\nUpdated file contents:\n';
	for (let i = 0; i < newLines.length; i++) {
		const lineNumStr = String(i + 1).padStart(4, ' ');
		const line = newLines[i] || '';
		fileContext += `${lineNumStr}: ${line}\n`;
	}

	const rangeDesc =
		startLine === endLine
			? `line ${startLine}`
			: `lines ${startLine}-${endLine}`;
	const newRangeDesc =
		startLine === newEndLine
			? `line ${startLine}`
			: `lines ${startLine}-${newEndLine}`;

	return `Successfully replaced content at ${rangeDesc} (now ${newRangeDesc}).${fileContext}`;
};

const stringReplaceCoreTool = tool({
	description:
		'Replace exact string content in a file. IMPORTANT: Provide exact content including whitespace and surrounding context. For unique matching, include 2-3 lines before/after the change. Break large changes into multiple small replacements.',
	inputSchema: jsonSchema<StringReplaceArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The path to the file to edit.',
			},
			old_str: {
				type: 'string',
				description:
					'The EXACT string to find and replace, including all whitespace, newlines, and indentation. Must match exactly. Include surrounding context (2-3 lines) to ensure unique match.',
			},
			new_str: {
				type: 'string',
				description:
					'The replacement string. Can be empty to delete content. Must preserve proper indentation and formatting.',
			},
		},
		required: ['path', 'old_str', 'new_str'],
	}),

	// Medium risk: file write operation, requires approval except in auto-accept mode or if configured in nanocoderTools.alwaysAllow
	// In plan mode, direct editing is disabled (use write_file for plan updates)
	needsApproval: () => {
		// Check if this tool is configured to always be allowed
		if (isNanocoderToolAlwaysAllowed('string_replace')) {
			return false;
		}

		const mode = getCurrentMode();
		// In plan mode, always require approval (blocks direct editing)
		if (mode === 'plan') {
			return true;
		}
		return mode !== 'auto-accept'; // true in normal, false in auto-accept
	},
	execute: async (args, _options) => {
		return await executeStringReplace(args);
	},
});

const StringReplaceFormatter = React.memo(
	({preview}: {preview: React.ReactElement}) => {
		return preview;
	},
);

async function formatStringReplacePreview(
	args: StringReplaceArgs,
	result?: string,
	colors?: Colors,
): Promise<React.ReactElement> {
	const themeColors = colors || getColors();
	const {path, old_str, new_str} = args;

	const isResult = result !== undefined;

	try {
		const absPath = resolve(path);
		const cached = await getCachedFileContent(absPath);
		const fileContent = cached.content;
		const ext = path.split('.').pop()?.toLowerCase() ?? '';
		const language = getLanguageFromExtension(ext);

		// In result mode, skip validation since file has already been modified
		// Preview mode - validate old_str exists and is unique
		if (!isResult) {
			const occurrences = fileContent.split(old_str).length - 1;

			if (occurrences === 0) {
				const errorContent = (
					<Box flexDirection="column" marginBottom={1}>
						<Text color={themeColors.tool}>⚒ string_replace</Text>

						<Box>
							<Text color={themeColors.secondary}>Path: </Text>
							<Text color={themeColors.primary}>{path}</Text>
						</Box>

						<Box flexDirection="column" marginTop={1}>
							<Text color={themeColors.error}>
								✗ Error: Content not found in file. The file may have changed
								since you last read it.
							</Text>
						</Box>

						<Box flexDirection="column" marginTop={1}>
							<Text color={themeColors.secondary}>Searching for:</Text>
							{old_str.split('\n').map((line, i) => (
								<Text key={i} color={themeColors.text}>
									{line}
								</Text>
							))}
						</Box>
					</Box>
				);
				return <ToolMessage message={errorContent} hideBox={true} />;
			}

			if (occurrences > 1) {
				const errorContent = (
					<Box flexDirection="column">
						<Text color={themeColors.tool}>⚒ string_replace</Text>

						<Box>
							<Text color={themeColors.secondary}>Path: </Text>
							<Text color={themeColors.primary}>{path}</Text>
						</Box>

						<Box flexDirection="column" marginTop={1}>
							<Text color={themeColors.error}>
								✗ Error: Found {occurrences} matches
							</Text>
							<Text color={themeColors.secondary}>
								Add more surrounding context to make the match unique.
							</Text>
						</Box>

						<Box flexDirection="column" marginTop={1}>
							<Text color={themeColors.secondary}>Searching for:</Text>
							{old_str.split('\n').map((line, i) => (
								<Text key={i} color={themeColors.text}>
									{line}
								</Text>
							))}
						</Box>
					</Box>
				);
				return <ToolMessage message={errorContent} hideBox={true} />;
			}
		}

		// Find location of the match in the file
		// In result mode, old_str no longer exists - find new_str instead
		const searchStr = isResult ? new_str : old_str;
		const matchIndex = fileContent.indexOf(searchStr);
		const beforeContent = fileContent.substring(0, matchIndex);
		const beforeLines = beforeContent.split('\n');
		const startLine = beforeLines.length;

		const oldStrLines = old_str.split('\n');
		const newStrLines = new_str.split('\n');
		// In result mode, the file contains new_str, so use its length for endLine
		const contentLines = isResult ? newStrLines : oldStrLines;
		const endLine = startLine + contentLines.length - 1;

		const allLines = fileContent.split('\n');
		const contextLines = 3;
		const showStart = Math.max(0, startLine - 1 - contextLines);
		const showEnd = Math.min(allLines.length - 1, endLine - 1 + contextLines);

		// Collect all lines to be displayed for normalization
		const linesToNormalize: string[] = [];

		// Context before - always from file
		for (let i = showStart; i < startLine - 1; i++) {
			linesToNormalize.push(allLines[i] || '');
		}

		// Old lines - always from old_str (not in file after execution)
		for (let i = 0; i < oldStrLines.length; i++) {
			linesToNormalize.push(oldStrLines[i] || '');
		}

		// New lines - in result mode, read from file; in preview mode, use new_str
		if (isResult) {
			for (let i = 0; i < newStrLines.length; i++) {
				linesToNormalize.push(allLines[startLine - 1 + i] || '');
			}
		} else {
			for (let i = 0; i < newStrLines.length; i++) {
				linesToNormalize.push(newStrLines[i] || '');
			}
		}

		// Context after - in result mode, start after new content
		const contextAfterStart = isResult
			? startLine - 1 + newStrLines.length
			: endLine;
		for (let i = contextAfterStart; i <= showEnd; i++) {
			linesToNormalize.push(allLines[i] || '');
		}

		// Normalize indentation
		const normalizedLines = normalizeIndentation(linesToNormalize);

		// Split normalized lines back into sections
		let lineIndex = 0;
		const contextBeforeCount = startLine - 1 - showStart;
		const normalizedContextBefore = normalizedLines.slice(
			lineIndex,
			lineIndex + contextBeforeCount,
		);
		lineIndex += contextBeforeCount;

		const normalizedOldLines = normalizedLines.slice(
			lineIndex,
			lineIndex + oldStrLines.length,
		);
		lineIndex += oldStrLines.length;

		const normalizedNewLines = normalizedLines.slice(
			lineIndex,
			lineIndex + newStrLines.length,
		);
		lineIndex += newStrLines.length;

		const normalizedContextAfter = normalizedLines.slice(lineIndex);

		const contextBefore: React.ReactElement[] = [];
		const diffLines: React.ReactElement[] = [];
		const contextAfter: React.ReactElement[] = [];

		// Show context before
		for (let i = 0; i < normalizedContextBefore.length; i++) {
			const actualLineNum = showStart + i;
			const lineNumStr = String(actualLineNum + 1).padStart(4, ' ');
			const line = normalizedContextBefore[i] || '';
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

		// Build unified diff - only show lines that actually changed
		let oldIdx = 0;
		let newIdx = 0;
		let diffKey = 0;

		while (
			oldIdx < normalizedOldLines.length ||
			newIdx < normalizedNewLines.length
		) {
			const oldLine =
				oldIdx < normalizedOldLines.length ? normalizedOldLines[oldIdx] : null;
			const newLine =
				newIdx < normalizedNewLines.length ? normalizedNewLines[newIdx] : null;

			// Check if lines are identical - show as unchanged context
			if (oldLine !== null && newLine !== null && oldLine === newLine) {
				const lineNumStr = String(startLine + oldIdx).padStart(4, ' ');
				diffLines.push(
					<Text
						key={`diff-${diffKey++}`}
						color={themeColors.secondary}
						wrap="wrap"
					>
						{lineNumStr} {oldLine}
					</Text>,
				);
				oldIdx++;
				newIdx++;
			} else if (
				oldLine !== null &&
				newLine !== null &&
				areLinesSimlar(oldLine, newLine)
			) {
				// Lines are similar but different - show inline diff with word-level highlighting
				const segments = computeInlineDiff(oldLine, newLine);
				const lineNumStr = String(startLine + oldIdx).padStart(4, ' ');

				// Render removed line with inline highlights
				const oldParts: React.ReactElement[] = [];
				for (let s = 0; s < segments.length; s++) {
					const seg = segments[s];
					if (seg.type === 'unchanged' || seg.type === 'removed') {
						oldParts.push(
							<Text
								key={`old-seg-${s}`}
								bold={seg.type === 'removed'}
								underline={seg.type === 'removed'}
							>
								{seg.text}
							</Text>,
						);
					}
				}

				diffLines.push(
					<Text
						key={`diff-${diffKey++}`}
						backgroundColor={themeColors.diffRemoved}
						color={themeColors.diffRemovedText}
						wrap="wrap"
					>
						{lineNumStr} - {oldParts}
					</Text>,
				);

				// Render added line with inline highlights
				const newParts: React.ReactElement[] = [];
				for (let s = 0; s < segments.length; s++) {
					const seg = segments[s];
					if (seg.type === 'unchanged' || seg.type === 'added') {
						newParts.push(
							<Text
								key={`new-seg-${s}`}
								bold={seg.type === 'added'}
								underline={seg.type === 'added'}
							>
								{seg.text}
							</Text>,
						);
					}
				}

				diffLines.push(
					<Text
						key={`diff-${diffKey++}`}
						backgroundColor={themeColors.diffAdded}
						color={themeColors.diffAddedText}
						wrap="wrap"
					>
						{lineNumStr} + {newParts}
					</Text>,
				);

				oldIdx++;
				newIdx++;
			} else if (oldLine !== null) {
				// Show removed line
				const lineNumStr = String(startLine + oldIdx).padStart(4, ' ');
				diffLines.push(
					<Text
						key={`diff-${diffKey++}`}
						backgroundColor={themeColors.diffRemoved}
						color={themeColors.diffRemovedText}
						wrap="wrap"
					>
						{lineNumStr} - {oldLine}
					</Text>,
				);
				oldIdx++;
			} else if (newLine !== null) {
				// Show added line
				const lineNumStr = String(startLine + newIdx).padStart(4, ' ');
				diffLines.push(
					<Text
						key={`diff-${diffKey++}`}
						backgroundColor={themeColors.diffAdded}
						color={themeColors.diffAddedText}
						wrap="wrap"
					>
						{lineNumStr} + {newLine}
					</Text>,
				);
				newIdx++;
			}
		}

		// Show context after
		const lineDelta = newStrLines.length - oldStrLines.length;
		for (let i = 0; i < normalizedContextAfter.length; i++) {
			const actualLineNum = endLine + i;
			const lineNumStr = String(actualLineNum + lineDelta + 1).padStart(4, ' ');
			const line = normalizedContextAfter[i] || '';
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
			startLine === endLine
				? `line ${startLine}`
				: `lines ${startLine}-${endLine}`;

		const messageContent = (
			<Box flexDirection="column">
				<Text color={themeColors.tool}>⚒ string_replace</Text>

				<Box>
					<Text color={themeColors.secondary}>Path: </Text>
					<Text color={themeColors.primary}>{path}</Text>
				</Box>

				<Box>
					<Text color={themeColors.secondary}>Location: </Text>
					<Text color={themeColors.text}>{rangeDesc}</Text>
				</Box>

				<Box flexDirection="column" marginTop={1}>
					<Text color={themeColors.success}>
						{isResult ? '✓ Replace completed' : '✓ Replacing'}{' '}
						{oldStrLines.length} line{oldStrLines.length > 1 ? 's' : ''} with{' '}
						{newStrLines.length} line
						{newStrLines.length > 1 ? 's' : ''}
					</Text>
					<Box flexDirection="column">
						{contextBefore}
						{diffLines}
						{contextAfter}
					</Box>
				</Box>
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	} catch (error) {
		const errorContent = (
			<Box flexDirection="column">
				<Text color={themeColors.tool}>⚒ string_replace</Text>

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

const stringReplaceFormatter = async (
	args: StringReplaceArgs,
	result?: string,
): Promise<React.ReactElement> => {
	const colors = getColors();
	const {path, old_str, new_str} = args;
	const absPath = resolve(path);

	// Send diff to VS Code during preview phase (before execution)
	if (result === undefined && isVSCodeConnected()) {
		try {
			const cached = await getCachedFileContent(absPath);
			const fileContent = cached.content;

			// Only send if we can find a unique match
			const occurrences = fileContent.split(old_str).length - 1;
			if (occurrences === 1) {
				const newContent = fileContent.replace(old_str, new_str);

				const changeId = sendFileChangeToVSCode(
					absPath,
					fileContent,
					newContent,
					'string_replace',
					{
						path,
						old_str,
						new_str,
					},
				);
				if (changeId) {
					vscodeChangeIds.set(absPath, changeId);
				}
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

	const preview = await formatStringReplacePreview(args, result, colors);
	return <StringReplaceFormatter preview={preview} />;
};

const stringReplaceValidator = async (
	args: StringReplaceArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const {path, old_str} = args;

	// Validate path boundary first to prevent directory traversal
	if (!isValidFilePath(path)) {
		return {
			valid: false,
			error: `⚒ Invalid file path: "${path}". Path must be relative and within the project directory.`,
		};
	}

	// Verify the resolved path stays within project boundaries
	try {
		const cwd = process.cwd();
		resolveFilePath(path, cwd);
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		return {
			valid: false,
			error: `⚒ Path validation failed: ${errorMessage}`,
		};
	}

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

	// Validate old_str is not empty
	if (!old_str || old_str.length === 0) {
		return {
			valid: false,
			error:
				'⚒ old_str cannot be empty. Provide the exact content to find and replace.',
		};
	}

	// Check if content exists in file and is unique
	try {
		const cached = await getCachedFileContent(absPath);
		const fileContent = cached.content;
		const occurrences = fileContent.split(old_str).length - 1;

		if (occurrences === 0) {
			return {
				valid: false,
				error: `⚒ Content not found in file. The file may have changed since you last read it.\n\nSearching for:\n${old_str}\n\nSuggestion: Read the file again to see current contents.`,
			};
		}

		if (occurrences > 1) {
			return {
				valid: false,
				error: `⚒ Found ${occurrences} matches for the search string. Please provide more surrounding context to make the match unique.\n\nSearching for:\n${old_str}`,
			};
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			valid: false,
			error: `⚒ Error reading file "${path}": ${errorMessage}`,
		};
	}

	return {valid: true};
};

export const stringReplaceTool: NanocoderToolExport = {
	name: 'string_replace' as const,
	tool: stringReplaceCoreTool,
	formatter: stringReplaceFormatter,
	validator: stringReplaceValidator,
};
