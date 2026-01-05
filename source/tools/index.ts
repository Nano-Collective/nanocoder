import React from 'react';
import {documentSymbolsTool} from '@/tools/document-symbols';
import {executeBashTool} from '@/tools/execute-bash';
import {extractFunctionTool} from '@/tools/extract-function';
import {fetchUrlTool} from '@/tools/fetch-url';
import {findFilesTool} from '@/tools/find-files';
import {findReferencesTool} from '@/tools/find-references';
import {
	gitBranchSuggestTool,
	gitCreatePRTool,
	gitSmartCommitTool,
	gitStatusEnhancedTool,
} from '@/tools/git';
import {goToDefinitionTool} from '@/tools/go-to-definition';
import {listDirectoryTool} from '@/tools/list-directory';
import {getDiagnosticsTool} from '@/tools/lsp-get-diagnostics';
import {mkdirTool} from '@/tools/mkdir';
import {mvTool} from '@/tools/mv';
import {readFileTool} from '@/tools/read-file';
import {renameSymbolTool} from '@/tools/rename-symbol';
import {rmTool} from '@/tools/rm';
import {rmdirTool} from '@/tools/rmdir';
import {searchFileContentsTool} from '@/tools/search-file-contents';
import {stringReplaceTool} from '@/tools/string-replace';
import {webSearchTool} from '@/tools/web-search';
import {writeFileTool} from '@/tools/write-file';
import type {
	AISDKCoreTool,
	NanocoderToolExport,
	StreamingFormatter,
	ToolHandler,
} from '@/types/index';

// Array of all tool exports from individual tool files
// Each tool exports: { name, tool, formatter?, validator? }
const allTools: NanocoderToolExport[] = [
	// File operations
	readFileTool,
	writeFileTool,
	stringReplaceTool,
	listDirectoryTool,
	mkdirTool,
	rmTool,
	rmdirTool,
	mvTool,

	// Search and discovery
	findFilesTool,
	searchFileContentsTool,

	// Command execution
	executeBashTool,

	// Web tools
	webSearchTool,
	fetchUrlTool,

	// LSP code intelligence
	getDiagnosticsTool,
	findReferencesTool,
	goToDefinitionTool,
	documentSymbolsTool,
	renameSymbolTool,
	extractFunctionTool,

	// Git workflow
	gitSmartCommitTool,
	gitCreatePRTool,
	gitBranchSuggestTool,
	gitStatusEnhancedTool,
];

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
