import {readFileTool} from '@/tools/read-file';
import {createFileTool} from '@/tools/create-file';
import {insertLinesTool} from '@/tools/insert-lines';
import {replaceLinesTool} from '@/tools/replace-lines';
import {deleteLinesTool} from '@/tools/delete-lines';
import {executeBashTool} from '@/tools/execute-bash';
import {webSearchTool} from '@/tools/web-search';
import {fetchUrlTool} from '@/tools/fetch-url';
import {findFilesTool} from '@/tools/find-files';
import {searchFileContentsTool} from '@/tools/search-file-contents';
import {getDiagnosticsTool} from '@/tools/lsp-get-diagnostics';
import React from 'react';
import type {
	ToolHandler,
	AISDKCoreTool,
	NanocoderToolExport,
} from '@/types/index';

// Array of all tool exports from individual tool files
// Each tool exports: { name, tool, formatter?, validator? }
const allTools: NanocoderToolExport[] = [
	readFileTool,
	createFileTool,
	insertLinesTool,
	replaceLinesTool,
	deleteLinesTool,
	executeBashTool,
	webSearchTool,
	fetchUrlTool,
	findFilesTool,
	searchFileContentsTool,
	getDiagnosticsTool,
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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async (args: any) => {
			// Call the tool's execute function with a dummy options object
			// The actual options will be provided by AI SDK during automatic execution
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(args: any) => Promise<{valid: true} | {valid: false; error: string}>
	>,
);
