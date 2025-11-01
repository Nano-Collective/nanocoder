import {readFileTool} from '@/tools/read-file';
import {createFileTool} from '@/tools/create-file';
import {insertLinesTool} from '@/tools/insert-lines';
import {replaceLinesTool} from '@/tools/replace-lines';
import {deleteLinesTool} from '@/tools/delete-lines';
import {readManyFilesTool} from '@/tools/read-many-files';
import {executeBashTool} from '@/tools/execute-bash';
import {webSearchTool} from '@/tools/web-search';
import {fetchUrlTool} from '@/tools/fetch-url';
import {searchFilesTool} from '@/tools/search-files';
import React from 'react';
import type {ToolHandler, ToolDefinition, AISDKCoreTool} from '@/types/index';

export const toolDefinitions: ToolDefinition[] = [
	readFileTool,
	createFileTool,
	insertLinesTool,
	replaceLinesTool,
	deleteLinesTool,
	readManyFilesTool,
	executeBashTool,
	webSearchTool,
	fetchUrlTool,
	searchFilesTool,
];

// Export handlers for manual execution (human-in-the-loop)
export const toolRegistry: Record<string, ToolHandler> = Object.fromEntries(
	toolDefinitions.map(def => [def.name, def.handler]),
);

// Native AI SDK tools registry (for passing directly to AI SDK)
export const nativeToolsRegistry: Record<string, AISDKCoreTool> =
	Object.fromEntries(toolDefinitions.map(def => [def.name, def.tool]));

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
> = Object.fromEntries(
	toolDefinitions
		.filter(def => def.formatter)
		.map(def => {
			const formatter = def.formatter;
			if (!formatter) {
				throw new Error(`Formatter is undefined for tool ${def.name}`);
			}
			return [def.name, formatter];
		}),
);

// Export validator registry
export const toolValidators: Record<
	string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(args: any) => Promise<{valid: true} | {valid: false; error: string}>
> = Object.fromEntries(
	toolDefinitions
		.filter(def => def.validator)
		.map(def => {
			const validator = def.validator;
			if (!validator) {
				throw new Error(`Validator is undefined for tool ${def.name}`);
			}
			return [def.name, validator];
		}),
);
