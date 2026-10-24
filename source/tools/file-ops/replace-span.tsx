import {writeFile} from 'node:fs/promises';
import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {getColors} from '@/config/index';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {invalidateCache} from '@/utils/file-cache';
import {validateEditableFormat} from '@/utils/path-validators';
import {forgetReadContent, markFileSeen} from '@/utils/read-tracker';
import {consumeSpanHandle, resolveSpanHandle} from '@/utils/span-handles';
import {createFileToolApproval} from '@/utils/tool-approval';

interface ReplaceSpanArgs {
	handle: string;
	new_content: string;
}

const SPAN_CONTEXT_LINES = 20;

function formatUpdatedFileContext(
	content: string,
	startLine: number,
	endLine: number,
): string {
	const lines = content.split('\n');
	const contextStartLine = Math.max(1, startLine - SPAN_CONTEXT_LINES);
	const contextEndLine = Math.min(lines.length, endLine + SPAN_CONTEXT_LINES);

	let fileContext = `\n\nUpdated file context (lines ${contextStartLine}-${contextEndLine} of ${lines.length}):\n`;
	if (contextStartLine > 1) {
		fileContext += `[... lines 1-${contextStartLine - 1} omitted ...]\n`;
	}

	for (let i = contextStartLine - 1; i < contextEndLine; i++) {
		const lineNumStr = String(i + 1).padStart(4, ' ');
		fileContext += `${lineNumStr}: ${lines[i] || ''}\n`;
	}

	if (contextEndLine < lines.length) {
		fileContext += `[... lines ${contextEndLine + 1}-${lines.length} omitted ...]\n`;
	}

	return fileContext;
}

/** Error text shared by the handler and the validator, so both agree. */
function describeResolutionFailure(resolution: {
	status: 'unknown' | 'file-missing' | 'stale';
	path?: string;
}): string {
	switch (resolution.status) {
		case 'unknown':
			return 'Unknown span handle. It may have been evicted from a very long session, or never existed — call read_file or search_file_contents to get a fresh handle.';
		case 'file-missing':
			return `"${resolution.path}" no longer exists.`;
		case 'stale':
			return `The content at this span has changed since the handle was issued (edited since, or by an overlapping span's edit). Re-read "${resolution.path}" to get a fresh handle.`;
	}
}

const executeReplaceSpan = async (args: ReplaceSpanArgs): Promise<string> => {
	const {handle, new_content} = args;

	const resolution = await resolveSpanHandle(handle);
	if (resolution.status !== 'ok') {
		throw new Error(describeResolutionFailure(resolution));
	}

	const formatResult = validateEditableFormat(resolution.path);
	if (!formatResult.valid) {
		throw new Error(formatResult.error);
	}

	const {path, startLine, endLine, fullContent} = resolution;
	const lines = fullContent.split('\n');
	const newContentLines = new_content.split('\n');
	const newLines = [
		...lines.slice(0, startLine - 1),
		...newContentLines,
		...lines.slice(endLine),
	];
	const newContent = newLines.join('\n');

	await writeFile(path, newContent, 'utf-8');
	invalidateCache(path);
	consumeSpanHandle(handle);
	// The model now knows the file's current contents, so a follow-up edit is
	// not blind.
	markFileSeen(path);
	forgetReadContent(path);

	const newEndLine = startLine + newContentLines.length - 1;
	const rangeDesc =
		startLine === endLine
			? `line ${startLine}`
			: `lines ${startLine}-${endLine}`;
	const newRangeDesc =
		startLine === newEndLine
			? `line ${startLine}`
			: `lines ${startLine}-${newEndLine}`;

	return `Successfully replaced content at ${rangeDesc} (now ${newRangeDesc}).${formatUpdatedFileContext(newContent, startLine, newEndLine)}`;
};

const replaceSpanCoreTool = tool({
	description:
		'Replace the content at a span handle returned by read_file or search_file_contents (e.g. "@span:k7"), without retyping the original text. The handle is resolved to its file and line range and its content hash is rechecked against the live file, so a stale handle (file changed, or an earlier span edit shifted these lines) fails cleanly instead of corrupting the file. Prefer this over string_replace when editing content a handle was issued for.',
	inputSchema: jsonSchema<ReplaceSpanArgs>({
		type: 'object',
		properties: {
			handle: {
				type: 'string',
				description:
					'The span handle to edit, exactly as shown in the read_file or search_file_contents output (e.g. "@span:k7").',
			},
			new_content: {
				type: 'string',
				description:
					"The text to replace the span's content with. Can be empty to delete it. Must preserve proper indentation and formatting.",
			},
		},
		required: ['handle', 'new_content'],
	}),
	execute: async (args, _options) => {
		return await executeReplaceSpan(args);
	},
});

const replaceSpanFormatter = async (
	args: ReplaceSpanArgs,
	result?: string,
): Promise<React.ReactElement> => {
	const colors = getColors();

	return (
		<ToolMessage
			message={
				<Box flexDirection="column">
					<Text color={colors.tool}>⚒ replace_span</Text>
					<Box>
						<Text color={colors.secondary}>Handle: </Text>
						<Text color={colors.text}>{args.handle}</Text>
					</Box>
					{result && !result.startsWith('Error:') && (
						<Text color={colors.success}>{result.split('\n')[0]}</Text>
					)}
				</Box>
			}
			hideBox={true}
		/>
	);
};

const replaceSpanValidator = async (
	args: ReplaceSpanArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const {handle, new_content} = args;

	if (!handle || handle.length === 0) {
		return {
			valid: false,
			error:
				'handle cannot be empty. Call read_file or search_file_contents to get a span handle first.',
		};
	}

	if (new_content === undefined) {
		return {
			valid: false,
			error:
				'new_content is required. Pass an empty string to delete the span.',
		};
	}

	const resolution = await resolveSpanHandle(handle);
	if (resolution.status !== 'ok') {
		return {valid: false, error: describeResolutionFailure(resolution)};
	}

	// No separate path-boundary check here: the handle only exists because
	// read_file or search_file_contents already validated and read this exact
	// path this session.
	const formatResult = validateEditableFormat(resolution.path);
	if (!formatResult.valid) return formatResult;

	return {valid: true};
};

export const replaceSpanTool: NanocoderToolExport = {
	name: 'replace_span' as const,
	tool: replaceSpanCoreTool,
	formatter: replaceSpanFormatter,
	validator: replaceSpanValidator,
	approval: createFileToolApproval('replace_span'),
};
