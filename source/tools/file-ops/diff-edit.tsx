import {constants} from 'node:fs';
import {access, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import {getSafeSessionCwd} from '@/services/session-cwd';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {getCachedFileContent, invalidateCache} from '@/utils/file-cache';
import {replaceFirstLiteral} from '@/utils/literal-replace';
import {validatePath} from '@/utils/path-validators';
import {hasSeenFile, markFileSeen} from '@/utils/read-tracker';
import {createFileToolApproval} from '@/utils/tool-approval';
import {
	closeDiffInVSCode,
	isVSCodeConnected,
	sendFileChangeToVSCode,
} from '@/vscode/index';

interface DiffEditArgs {
	path: string;
	diff: string;
}

export interface DiffEditBlock {
	search: string;
	replace: string;
}

const SEARCH_MARKER = '<<<<<<< SEARCH';
const SEPARATOR_MARKER = '=======';
const REPLACE_MARKER = '>>>>>>> REPLACE';
const DIFF_EDIT_CONTEXT_LINES = 3;
const MAX_DIFF_EDIT_RESULT_CHARS = 4000;

function capDiffEditResult(content: string): string {
	if (content.length <= MAX_DIFF_EDIT_RESULT_CHARS) return content;

	const marker = `\n... [Preview truncated: ${content.length} characters; use read_file with a narrow range to inspect omitted content] ...\n`;
	const remainingLength = MAX_DIFF_EDIT_RESULT_CHARS - marker.length;
	const headLength = Math.floor(remainingLength / 2);
	const tailLength = remainingLength - headLength;

	return `${content.slice(0, headLength)}${marker}${content.slice(-tailLength)}`;
}

function stripSingleBoundaryNewline(value: string): string {
	if (value.startsWith('\r\n')) return value.slice(2);
	if (value.startsWith('\n')) return value.slice(1);
	return value;
}

function stripTrailingBoundaryNewline(value: string): string {
	if (value.endsWith('\r\n')) return value.slice(0, -2);
	if (value.endsWith('\n')) return value.slice(0, -1);
	return value;
}

function normalizeBlockContent(value: string): string {
	return stripTrailingBoundaryNewline(stripSingleBoundaryNewline(value));
}

export function parseDiffEditBlocks(diff: string): DiffEditBlock[] {
	if (!diff || diff.trim().length === 0) {
		throw new Error(
			'diff cannot be empty. Provide at least one SEARCH/REPLACE block.',
		);
	}

	const blocks: DiffEditBlock[] = [];
	let index = 0;

	while (index < diff.length) {
		const searchStart = diff.indexOf(SEARCH_MARKER, index);
		if (searchStart === -1) {
			if (diff.slice(index).trim().length > 0 && blocks.length === 0) {
				throw new Error(`Missing ${SEARCH_MARKER} marker.`);
			}
			break;
		}

		const searchContentStart = searchStart + SEARCH_MARKER.length;
		const separatorStart = diff.indexOf(SEPARATOR_MARKER, searchContentStart);
		if (separatorStart === -1) {
			throw new Error(
				`Diff block ${blocks.length + 1} is missing ======= separator.`,
			);
		}

		const replaceContentStart = separatorStart + SEPARATOR_MARKER.length;
		const replaceEnd = diff.indexOf(REPLACE_MARKER, replaceContentStart);
		if (replaceEnd === -1) {
			throw new Error(
				`Diff block ${blocks.length + 1} is missing >>>>>>> REPLACE marker.`,
			);
		}

		const search = normalizeBlockContent(
			diff.slice(searchContentStart, separatorStart),
		);
		const replace = normalizeBlockContent(
			diff.slice(replaceContentStart, replaceEnd),
		);

		if (search.length === 0) {
			throw new Error(`Search block ${blocks.length + 1} cannot be empty.`);
		}

		blocks.push({search, replace});
		index = replaceEnd + REPLACE_MARKER.length;
	}

	if (blocks.length === 0) {
		throw new Error('No SEARCH/REPLACE blocks found in diff.');
	}

	return blocks;
}

function countOccurrences(content: string, search: string): number {
	return content.split(search).length - 1;
}

function validateBlocks(fileContent: string, blocks: DiffEditBlock[]): void {
	const seenSearchBlocks = new Set<string>();

	blocks.forEach((block, index) => {
		const blockNumber = index + 1;
		if (seenSearchBlocks.has(block.search)) {
			throw new Error(
				`Search block ${blockNumber} duplicates an earlier search block. Each SEARCH block must target a distinct original file range.`,
			);
		}
		seenSearchBlocks.add(block.search);

		const occurrences = countOccurrences(fileContent, block.search);

		if (occurrences === 0) {
			throw new Error(
				`Search block ${blockNumber} was not found in file. The file may have changed since you last read it.`,
			);
		}

		if (occurrences > 1) {
			throw new Error(
				`Search block ${blockNumber} matched ${occurrences} times. Add surrounding context so it is unique.`,
			);
		}
	});
}

function applyBlocks(fileContent: string, blocks: DiffEditBlock[]): string {
	let newContent = fileContent;

	blocks.forEach((block, index) => {
		const occurrences = countOccurrences(newContent, block.search);
		if (occurrences !== 1) {
			throw new Error(
				`Search block ${index + 1} could not be applied cleanly after earlier edits.`,
			);
		}

		newContent = replaceFirstLiteral(newContent, block.search, block.replace);
	});

	return newContent;
}

function formatUpdatedFileContext(
	originalContent: string,
	updatedContent: string,
	blocks: DiffEditBlock[],
): string {
	const lines = updatedContent.split('\n');
	let cumulativeOffset = 0;
	const changedRanges = blocks
		.map(block => ({
			block,
			originalIndex: originalContent.indexOf(block.search),
		}))
		.sort((a, b) => a.originalIndex - b.originalIndex)
		.map(({block, originalIndex}) => {
			const updatedIndex = originalIndex + cumulativeOffset;
			const changedStart = updatedContent
				.slice(0, updatedIndex)
				.split('\n').length;
			const replacementLineCount = Math.max(
				1,
				block.replace.split('\n').length,
			);
			const changedEnd = Math.min(
				lines.length,
				changedStart + replacementLineCount - 1,
			);

			cumulativeOffset += block.replace.length - block.search.length;
			return {
				changedStart,
				changedEnd,
				start: Math.max(1, changedStart - DIFF_EDIT_CONTEXT_LINES),
				end: Math.min(lines.length, changedEnd + DIFF_EDIT_CONTEXT_LINES),
			};
		});
	const changedRegionSummary = changedRanges
		.map(({changedStart, changedEnd}) =>
			changedStart === changedEnd
				? String(changedStart)
				: `${changedStart}-${changedEnd}`,
		)
		.join(', ');

	const contextWindows = changedRanges.reduce<
		Array<{start: number; end: number}>
	>((windows, range) => {
		const previous = windows.at(-1);
		if (previous && range.start <= previous.end + 1) {
			previous.end = Math.max(previous.end, range.end);
		} else {
			windows.push({...range});
		}
		return windows;
	}, []);

	return (
		`\n\nChanged regions: lines ${changedRegionSummary}.` +
		contextWindows
			.map(({start, end}, index) => {
				let context = `\n\nUpdated file context (lines ${start}-${end} of ${lines.length}):\n`;
				const previousEnd = contextWindows[index - 1]?.end ?? 0;
				if (start > previousEnd + 1) {
					context += `[... lines ${previousEnd + 1}-${start - 1} omitted ...]\n`;
				}

				for (let lineNumber = start; lineNumber <= end; lineNumber++) {
					const lineNumStr = String(lineNumber).padStart(4, ' ');
					context += `${lineNumStr}: ${lines[lineNumber - 1] || ''}\n`;
				}

				if (index === contextWindows.length - 1 && end < lines.length) {
					context += `[... lines ${end + 1}-${lines.length} omitted ...]\n`;
				}
				return context;
			})
			.join('')
	);
}

const executeDiffEdit = async (args: DiffEditArgs): Promise<string> => {
	const {path, diff} = args;
	const absPath = resolve(getSafeSessionCwd(), path);
	const blocks = parseDiffEditBlocks(diff);
	const cached = await getCachedFileContent(absPath);
	const fileContent = cached.content;

	validateBlocks(fileContent, blocks);
	const newContent = applyBlocks(fileContent, blocks);

	await writeFile(absPath, newContent, 'utf-8');
	invalidateCache(absPath);
	markFileSeen(absPath);

	const blockLabel = blocks.length === 1 ? 'block' : 'blocks';
	return capDiffEditResult(
		`Successfully applied ${blocks.length} diff ${blockLabel}.${formatUpdatedFileContext(fileContent, newContent, blocks)}`,
	);
};

const diffEditCoreTool = tool({
	description:
		'Apply one or more SEARCH/REPLACE edit blocks to a file. Use this for weak local models when exact string_replace arguments are hard to produce. Every SEARCH block must match the file exactly once. Format: <<<<<<< SEARCH, old content, =======, new content, >>>>>>> REPLACE. Do not wrap the diff in a markdown code fence. Successful edits return bounded context around changed regions instead of the entire file.',
	inputSchema: jsonSchema<DiffEditArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The path to the file to edit.',
			},
			diff: {
				type: 'string',
				description:
					'One or more SEARCH/REPLACE blocks using <<<<<<< SEARCH, =======, and >>>>>>> REPLACE markers. Do not wrap the diff in markdown code fences or backticks.',
			},
		},
		required: ['path', 'diff'],
	}),
	execute: async (args, _options) => {
		return await executeDiffEdit(args);
	},
});

function DiffEditPreview({
	args,
	result,
}: {
	args: DiffEditArgs;
	result?: string;
}) {
	const themeContext = React.useContext(ThemeContext);
	if (!themeContext) {
		throw new Error('ThemeContext is required');
	}
	const {colors} = themeContext;

	const {blocks, parseError} = React.useMemo<{
		blocks: DiffEditBlock[];
		parseError: string | null;
	}>(() => {
		try {
			return {blocks: parseDiffEditBlocks(args.diff), parseError: null};
		} catch (error) {
			return {blocks: [], parseError: formatError(error)};
		}
	}, [args.diff]);

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>diff_edit</Text>
			<Box>
				<Text color={colors.secondary}>Path: </Text>
				<Text color={colors.text}>{args.path}</Text>
			</Box>
			{result ? (
				<Text color={colors.success}>{result.split('\n\n')[0]}</Text>
			) : parseError ? (
				<Text color={colors.error}>{parseError}</Text>
			) : (
				<Box flexDirection="column" marginTop={1}>
					{blocks.map((block, index) => (
						<Box key={index} flexDirection="column" marginBottom={1}>
							<Text color={colors.secondary}>Block {index + 1}</Text>
							<Text color={colors.error}>- {block.search}</Text>
							<Text color={colors.success}>+ {block.replace}</Text>
						</Box>
					))}
				</Box>
			)}
		</Box>
	);

	return <ToolMessage message={messageContent} hideBox={true} />;
}

const vscodeChangeIds = new Map<string, string>();

const diffEditFormatter = async (
	args: DiffEditArgs,
	result?: string,
): Promise<React.ReactElement> => {
	const absPath = resolve(getSafeSessionCwd(), args.path);

	if (result === undefined && isVSCodeConnected()) {
		try {
			const blocks = parseDiffEditBlocks(args.diff);
			const cached = await getCachedFileContent(absPath);
			const fileContent = cached.content;
			validateBlocks(fileContent, blocks);
			const newContent = applyBlocks(fileContent, blocks);
			const changeId = sendFileChangeToVSCode(
				absPath,
				fileContent,
				newContent,
				'diff_edit',
				{path: args.path, diff: args.diff},
			);

			if (changeId) {
				const previousChangeId = vscodeChangeIds.get(absPath);
				if (previousChangeId) {
					closeDiffInVSCode(previousChangeId);
				}
				vscodeChangeIds.set(absPath, changeId);
			}
		} catch {
			// Preview rendering should not fail because VS Code diff setup failed.
		}
	} else if (result !== undefined && isVSCodeConnected()) {
		const changeId = vscodeChangeIds.get(absPath);
		if (changeId) {
			closeDiffInVSCode(changeId);
			vscodeChangeIds.delete(absPath);
		}
	}

	return <DiffEditPreview args={args} result={result} />;
};

const diffEditValidator = async (
	args: DiffEditArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const pathResult = validatePath(args.path);
	if (!pathResult.valid) return pathResult;

	let blocks: DiffEditBlock[];
	try {
		blocks = parseDiffEditBlocks(args.diff);
	} catch (error) {
		return {valid: false, error: formatError(error)};
	}

	const absPath = resolve(getSafeSessionCwd(), args.path);
	try {
		await access(absPath, constants.F_OK);
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error) {
			if (error.code === 'ENOENT') {
				return {
					valid: false,
					error: `File "${args.path}" does not exist`,
				};
			}
		}
		return {
			valid: false,
			error: `Cannot access file "${args.path}": ${formatError(error)}`,
		};
	}

	if (!hasSeenFile(absPath)) {
		return {
			valid: false,
			error: `You must read "${args.path}" before editing it. Call read_file on it first — if the file is over 300 lines, specify start_line and end_line to read its actual content, not just metadata — then retry diff_edit with SEARCH blocks copied from the file.`,
		};
	}

	try {
		const cached = await getCachedFileContent(absPath);
		validateBlocks(cached.content, blocks);
	} catch (error) {
		return {
			valid: false,
			error: formatError(error),
		};
	}

	return {valid: true};
};

export const diffEditTool: NanocoderToolExport = {
	name: 'diff_edit' as const,
	tool: diffEditCoreTool,
	formatter: diffEditFormatter,
	validator: diffEditValidator,
	approval: createFileToolApproval('diff_edit'),
};
