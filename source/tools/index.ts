import React from 'react';
import {askQuestionTool} from '@/tools/ask-question';
import {executeBashTool} from '@/tools/execute-bash';
import {fetchUrlTool} from '@/tools/fetch-url';
import {findFilesTool} from '@/tools/find-files';
import {getGitTools} from '@/tools/git';
import {listDirectoryTool} from '@/tools/list-directory';
import {getDiagnosticsTool} from '@/tools/lsp-get-diagnostics';
import {readFileTool} from '@/tools/read-file';
import {searchFileContentsTool} from '@/tools/search-file-contents';
import {stringReplaceTool} from '@/tools/string-replace';
import {
	createTaskTool,
	deleteTaskTool,
	listTasksTool,
	updateTaskTool,
} from '@/tools/tasks';
import {webSearchTool} from '@/tools/web-search';
import {writeFileTool} from '@/tools/write-file';
import type {
	AISDKCoreTool,
	NanocoderToolExport,
	StreamingFormatter,
	ToolHandler,
} from '@/types/index';

// Static tools (always available)
const staticTools: NanocoderToolExport[] = [
	readFileTool,
	writeFileTool,
	stringReplaceTool,
	executeBashTool,
	webSearchTool,
	fetchUrlTool,
	findFilesTool,
	searchFileContentsTool,
	getDiagnosticsTool,
	listDirectoryTool,
	// Interaction tools
	askQuestionTool,
	// Task management tools
	createTaskTool,
	listTasksTool,
	updateTaskTool,
	deleteTaskTool,
];

// Conditionally available tools (based on system capabilities)
// Git tools are only registered if git is installed
// PR tool additionally requires gh CLI
const conditionalTools: NanocoderToolExport[] = [...getGitTools()];

// Combine all tools
const allTools: NanocoderToolExport[] = [...staticTools, ...conditionalTools];

// Export native AI SDK tools registry (for passing directly to AI SDK)
export const nativeToolsRegistry: Record<string, AISDKCoreTool> =
	Object.fromEntries(allTools.map(t => [t.name, t.tool]));

// Export handlers for manual execution (human-in-the-loop)
// These are extracted from the AI SDK tools' execute functions
export const toolRegistry: Record<string, ToolHandler> = Object.fromEntries(
	allTools.map(t => [
		t.name,
		// Extract the execute function from the AI SDK tool
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required
		async (args: any) => {
			// Call the tool's execute function with a dummy options object
			// The actual options will be provided by AI SDK during automatic execution
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required
			return await (t.tool as any).execute(args, {
				toolCallId: 'manual',
				messages: [],
			});
		},
	]),
);

// Export formatter registry for the UI
export const toolFormatters: Record<
	string,
	(
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required
		args: any,
	) =>
		| string
		| Promise<string>
		| React.ReactElement
		| Promise<React.ReactElement>
> = allTools.reduce(
	(acc, t) => {
		if ('formatter' in t && t.formatter) {
			acc[t.name] = t.formatter;
		}
		return acc;
	},
	{} as Record<
		string,
		(
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required
			args: any,
		) =>
			| string
			| Promise<string>
			| React.ReactElement
			| Promise<React.ReactElement>
	>,
);

// Export validator registry
export const toolValidators: Record<
	string,
	// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required
	(args: any) => Promise<{valid: true} | {valid: false; error: string}>
> = allTools.reduce(
	(acc, t) => {
		if ('validator' in t && t.validator) {
			acc[t.name] = t.validator;
		}
		return acc;
	},
	{} as Record<
		string,
		// biome-ignore lint/suspicious/noExplicitAny: Dynamic typing required
		(args: any) => Promise<{valid: true} | {valid: false; error: string}>
	>,
);

// Export streaming formatter registry for real-time progress tools
export const toolStreamingFormatters: Record<string, StreamingFormatter> =
	allTools.reduce(
		(acc, t) => {
			if ('streamingFormatter' in t && t.streamingFormatter) {
				acc[t.name] = t.streamingFormatter;
			}
			return acc;
		},
		{} as Record<string, StreamingFormatter>,
	);
