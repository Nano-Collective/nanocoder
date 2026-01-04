import {constants} from 'node:fs';
import {access, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';
import {DiffDisplay} from '@/components/diff-display';
import ToolMessage from '@/components/tool-message';
import {getColors} from '@/config/index';
import {getCurrentMode} from '@/context/mode-context';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import type {Colors} from '@/types/index';
import {estimateEditImpact} from '@/utils/edit-impact';
import {getCachedFileContent, invalidateCache} from '@/utils/file-cache';
import {getFileType} from '@/utils/file-type-detector';
import {normalizeIndentation} from '@/utils/indentation-normalizer';
import {getLanguageFromExtension} from '@/utils/programming-language-helper';
import {calculateTokens} from '@/utils/token-calculator';
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

	// Calculate change statistics
	const _tokens = calculateTokens(newContent);
	const _fileType = getFileType(path);

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

	const rangeDesc =
		startLine === endLine
			? `line ${startLine}`
			: `lines ${startLine}-${endLine}`;
	const newRangeDesc =
		startLine === newEndLine
			? `line ${startLine}`
			: `lines ${startLine}-${newEndLine}`;

	return `Successfully replaced content at ${rangeDesc} (now ${newRangeDesc}).`;
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
	// Medium risk: file write operation, requires approval except in auto-accept mode
	needsApproval: () => {
		const mode = getCurrentMode();
		return mode !== 'auto-accept'; // true in normal/plan, false in auto-accept
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
		const fileType = getFileType(path);

		// In result mode, skip validation since file has already been modified
		if (isResult) {
			const messageContent = (
				<Box flexDirection="column">
					<Text color={themeColors.tool}>⚒ string_replace</Text>

					<Box>
						<Text color={themeColors.secondary}>File: </Text>
						<Text color={themeColors.text}>{path}</Text>
					</Box>
					<Box>
						<Text color={themeColors.secondary}>Type: </Text>
						<Text color={themeColors.text}>{fileType}</Text>
					</Box>

					<Box flexDirection="column" marginTop={1}>
						<Text color={themeColors.success}>
							✓ String replacement completed successfully
						</Text>
					</Box>
				</Box>
			);

			return <ToolMessage message={messageContent} hideBox={true} />;
		}

		// Preview mode - validate old_str exists and is unique
		if (!isResult) {
			const occurrences = fileContent.split(old_str).length - 1;

					<Box>
						<Text color={themeColors.secondary}>File: </Text>
						<Text color={themeColors.text}>{path}</Text>
					</Box>

					<Box flexDirection="column" marginTop={1}>
						<Text color={themeColors.error}>
							✗ Error: Content not found in file.
						</Text>
						<Text color={themeColors.secondary}>
							The file may have changed since you last read it.
						</Text>
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

					<Box flexDirection="column" marginTop={1}>
						<Text color={themeColors.secondary}>
							Suggestion: Read the file again to see current contents.
						</Text>
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
						<Text color={themeColors.secondary}>File: </Text>
						<Text color={themeColors.text}>{path}</Text>
					</Box>

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

					<Box flexDirection="column" marginTop={1}>
						<Text color={themeColors.secondary}>
							Suggestion: Include 2-3 lines of surrounding context before and
							after the change.
						</Text>
					</Box>
				</Box>
			);
			return <ToolMessage message={errorContent} hideBox={true} />;
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

		// Calculate change statistics and file info
		const oldContent = fileContent;
		const _newContent = oldContent.replace(old_str, new_str);
		const fileLines = fileContent.split('\n');
		const fileTokens = calculateTokens(fileContent);

		const changeStats = {
			linesAdded: newStrLines.length,
			linesRemoved: oldStrLines.length,
			netLineChange: newStrLines.length - oldStrLines.length,
			tokensAdded: calculateTokens(new_str),
			tokensRemoved: calculateTokens(old_str),
			netTokenChange: 0, // Will be calculated
			changeType: 'replace' as const,
			sizeImpact: 'tiny' as const,
		};
		changeStats.netTokenChange =
			changeStats.tokensAdded - changeStats.tokensRemoved;

		// Calculate edit impact
		const impact = estimateEditImpact(changeStats, {
			lines: fileLines.length,
			tokens: fileTokens,
		});

		// Build context line objects
		const contextBeforeLines = normalizedContextBefore.map((line, i) => ({
			lineNum: showStart + i,
			content: line,
		}));

		const contextAfterLines = normalizedContextAfter.map((line, i) => ({
			lineNum: endLine + i,
			content: line,
		}));

		const rangeDesc =
			startLine === endLine
				? `line ${startLine}`
				: `lines ${startLine}-${endLine}`;

		const messageContent = (
			<Box flexDirection="column">
				<Text color={themeColors.tool}>⚒ string_replace</Text>

				<Box>
					<Text color={themeColors.secondary}>File: </Text>
					<Text color={themeColors.text}>{path}</Text>
				</Box>

				<Box>
					<Text color={themeColors.secondary}>Type: </Text>
					<Text color={themeColors.text}>{fileType}</Text>
				</Box>

				<Box>
					<Text color={themeColors.secondary}>Location: </Text>
					<Text color={themeColors.text}>{rangeDesc}</Text>
				</Box>

				<Box>
					<Text color={themeColors.secondary}>Impact: </Text>
					<Text color={themeColors.text}>{impact.description}</Text>
				</Box>

				{impact.shouldWarn && impact.recommendations.length > 0 && (
					<Box flexDirection="column" marginTop={1}>
						<Text color={themeColors.warning}>⚠ Warning: Large change</Text>
						{impact.recommendations.slice(0, 2).map((rec, i) => (
							<Text key={i} color={themeColors.secondary}>
								• {rec}
							</Text>
						))}
					</Box>
				)}

				<Box flexDirection="column" marginTop={1}>
					<Text color={themeColors.success}>
						{isResult ? '✓ Replace completed' : '✓ Replacing'}{' '}
						{oldStrLines.length} line{oldStrLines.length > 1 ? 's' : ''} with{' '}
						{newStrLines.length} line
						{newStrLines.length > 1 ? 's' : ''}
					</Text>
					<DiffDisplay
						oldLines={normalizedOldLines}
						newLines={normalizedNewLines}
						startLine={startLine}
						contextBeforeLines={contextBeforeLines}
						contextAfterLines={contextAfterLines}
						themeColors={themeColors}
						language={language}
					/>
				</Box>
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	} catch (error) {
		const errorContent = (
			<Box flexDirection="column">
				<Text color={themeColors.tool}>⚒ string_replace</Text>

				<Box>
					<Text color={themeColors.secondary}>File: </Text>
					<Text color={themeColors.text}>{path}</Text>
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

	// Validate old_str first (cheapest check)
	if (!old_str || old_str.length === 0 || old_str.trim() === '') {
		return {
			valid: false,
			error:
				'⚒ old_str cannot be empty. Provide the exact content to find and replace.',
		};
	}

	// Basic path validation - reject absolute paths, directory traversal, and null bytes
	if (
		path.startsWith('/') ||
		/^[A-Za-z]:/.test(path) ||
		path.includes('..') ||
		path.includes('\0')
	) {
		return {
			valid: false,
			error: `Invalid file path: "${path}". Absolute paths, path traversal, and null bytes not allowed.`,
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
					error: `File "${path}" does not exist\n\nSuggestion: Use find_files to locate the correct file path.`,
				};
			}
		}
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			valid: false,
			error: `Cannot access file "${path}": ${errorMessage}`,
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
				error: `Content not found in file. The file may have changed since you last read it.\n\nSearching for:\n${old_str}\n\nSuggestion: Read the file again to see current contents.`,
			};
		}

		if (occurrences > 1) {
			return {
				valid: false,
				error: `Found ${occurrences} matches for the search string. Please provide more surrounding context to make the match unique.\n\nSearching for:\n${old_str}`,
			};
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			valid: false,
			error: `Error reading file "${path}": ${errorMessage}`,
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
