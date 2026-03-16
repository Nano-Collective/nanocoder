import {constants} from 'node:fs';
import {access, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import React from 'react';

import {getColors} from '@/config/index';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {getCachedFileContent, invalidateCache} from '@/utils/file-cache';
import {validatePath} from '@/utils/path-validators';
import {createFileToolApproval} from '@/utils/tool-approval';
import {
	closeDiffInVSCode,
	isVSCodeConnected,
	sendFileChangeToVSCode,
} from '@/vscode/index';

import {formatStringReplacePreview} from './string-replace-preview';

interface StringReplaceArgs {
	path: string;
	old_str: string;
	new_str: string;
}

const executeStringReplace = async (
	args: StringReplaceArgs,
): Promise<string> => {
	const {path, old_str, new_str} = args;

	if (!old_str || old_str.length === 0) {
		throw new Error(
			'old_str cannot be empty. Provide the exact content to find and replace.',
		);
	}

	const absPath = resolve(path);
	const cached = await getCachedFileContent(absPath);
	const fileContent = cached.content;

	const occurrences = fileContent.split(old_str).length - 1;

	if (occurrences === 0) {
		throw new Error(
			`Content not found in file. The file may have changed since you last read it.\n`,
		);
	}

	if (occurrences > 1) {
		throw new Error(
			`Found ${occurrences} matches for the search string. Please provide more surrounding context to make the match unique\n`,
		);
	}

	const newContent = fileContent.replace(old_str, new_str);
	await writeFile(absPath, newContent, 'utf-8');
	invalidateCache(absPath);

	const beforeLines = fileContent.split('\n');
	const oldStrLines = old_str.split('\n');
	const newStrLines = new_str.split('\n');

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
	needsApproval: createFileToolApproval('string_replace'),
	execute: async (args, _options) => {
		return await executeStringReplace(args);
	},
});

// Track VS Code change IDs for cleanup
const vscodeChangeIds = new Map<string, string>();

const stringReplaceFormatter = async (
	args: StringReplaceArgs,
	result?: string,
): Promise<React.ReactElement> => {
	const colors = getColors();
	const {path, old_str, new_str} = args;
	const absPath = resolve(path);

	if (result === undefined && isVSCodeConnected()) {
		try {
			const cached = await getCachedFileContent(absPath);
			const fileContent = cached.content;

			const occurrences = fileContent.split(old_str).length - 1;
			if (occurrences === 1) {
				const newContent = fileContent.replace(old_str, new_str);

				const changeId = sendFileChangeToVSCode(
					absPath,
					fileContent,
					newContent,
					'string_replace',
					{path, old_str, new_str},
				);
				if (changeId) {
					vscodeChangeIds.set(absPath, changeId);
				}
			}
		} catch {
			// Silently ignore errors sending to VS Code
		}
	} else if (result !== undefined && isVSCodeConnected()) {
		const changeId = vscodeChangeIds.get(absPath);
		if (changeId) {
			closeDiffInVSCode(changeId);
			vscodeChangeIds.delete(absPath);
		}
	}

	return formatStringReplacePreview(args, result, colors);
};

const stringReplaceValidator = async (
	args: StringReplaceArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const {path, old_str} = args;

	const pathResult = validatePath(path);
	if (!pathResult.valid) return pathResult;

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

	if (!old_str || old_str.length === 0) {
		return {
			valid: false,
			error:
				'⚒ old_str cannot be empty. Provide the exact content to find and replace.',
		};
	}

	try {
		const cached = await getCachedFileContent(absPath);
		const fileContent = cached.content;
		const occurrences = fileContent.split(old_str).length - 1;

		if (occurrences === 0) {
			return {
				valid: false,
				error: `⚒ Content not found in file. The file may have changed since you last read it. Suggestion: Read the file again to see current contents.`,
			};
		}

		if (occurrences > 1) {
			return {
				valid: false,
				error: `⚒ Found ${occurrences} matches for the search string. Please provide more surrounding context to make the match unique.`,
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
