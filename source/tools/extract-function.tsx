import {constants} from 'node:fs';
import {access, writeFile} from 'node:fs/promises';
import {resolve as resolvePath} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {getCachedFileContent, invalidateCache} from '@/utils/file-cache';
import {executeToolWithErrorHandling} from '@/utils/lsp-error-handling';
import {getFileLanguage} from '@/utils/lsp-protocol-utils';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

interface ExtractFunctionArgs {
	path: string;
	function_name: string;
	start_line: number;
	end_line: number;
}

/**
 * Executes the extract function operation.
 *
 * @param args - Tool arguments including file path, function name, and line range
 * @returns Promise resolving to a formatted string with extraction result
 * @throws Error if validation fails or file operations fail
 *
 * @example
 * const result = await executeExtractFunction({
 *   path: 'src/app.ts',
 *   function_name: 'calculateTotal',
 *   start_line: 10,
 *   end_line: 15
 * });
 *
 * @description
 * This function creates a basic function skeleton from selected lines.
 * Manual adjustments may be needed for:
 * - Function parameters (variables used from outside the selection)
 * - Return value (if the function returns a result)
 * - This/Context (if the function uses class members)
 */
const executeExtractFunction = async (
	args: ExtractFunctionArgs,
): Promise<string> => {
	return executeToolWithErrorHandling(async () => {
		const _absPath = resolvePath(args.path);

		// Read file content
		const fileContent = await getCachedFileContent(args.path);
		const lines = fileContent.content.split('\n');

		// Validate line numbers
		if (args.start_line < 1 || args.start_line > lines.length) {
			throw new Error(`start_line must be between 1 and ${lines.length}`);
		}

		if (args.end_line < args.start_line || args.end_line > lines.length) {
			throw new Error(
				`end_line must be between start_line and ${lines.length}`,
			);
		}

		// Extract the selected lines (1-indexed to 0-indexed)
		const selectedLines = lines.slice(args.start_line - 1, args.end_line);

		if (selectedLines.length === 0) {
			throw new Error('No lines selected for extraction');
		}

		// Build the new function with placeholder parameters
		// User will manually adjust parameters, return values, and context
		const indent = '  '; // 2 spaces
		const newFunction = `${indent}function ${args.function_name}() {\n${selectedLines.map(line => indent + indent + line).join('\n')}\n${indent}}`;

		// Build the replacement call
		const callLine = `${indent}${indent}const result = ${args.function_name}();`;

		// Generate the modified content
		const before = lines.slice(0, args.start_line - 1);
		const after = lines.slice(args.end_line);

		// Find the parent function's indentation
		const parentIndent = lines[args.start_line - 1]?.match(/^\s*/)?.[0] || '';

		// Create new content with function definition and call
		const newContent = [
			...before,
			'', // blank line before new function
			`${parentIndent}// Extracted function: ${args.function_name}`,
			...newFunction.split('\n').map(line => parentIndent + line),
			'', // blank line after new function
			...lines.slice(args.start_line - 1, args.start_line).map(_line => {
				// Replace first line with function call
				return parentIndent + callLine;
			}),
			...after,
		].join('\n');

		// Write the modified content
		await writeFile(args.path, newContent, 'utf-8');
		invalidateCache(args.path);

		// Generate summary
		let output = `Extracted function '${args.function_name}' from lines ${args.start_line}-${args.end_line}.\n\n`;
		output += `⚠️  IMPORTANT: You may need to manually adjust:\n`;
		output += `   - Function parameters (add variables used from outside the selection)\n`;
		output += `   - Return value (if the function returns a result)\n`;
		output += `   - This/Context (if the function uses class members)\n\n`;
		output += `Function signature:\n`;
		output += `  function ${args.function_name}() {\n`;
		output += `    // ... extracted code ...\n`;
		output += `  }`;

		return output;
	});
};

const extractFunctionCoreTool = tool({
	description:
		'Extract selected lines into a new function. Creates a basic function skeleton - you will need to manually adjust parameters, return values, and context.\n\n' +
		'Example: Extract lines 10-15 into a new function called "calculateTotal" to refactor code for reusability.\n\n' +
		'Usage: Select the lines of code to extract by providing the file path, line range (start_line, end_line), and a name for the new function.',
	inputSchema: jsonSchema<ExtractFunctionArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'File path containing the code to extract',
			},
			function_name: {
				type: 'string',
				description: 'Name for the new function',
			},
			start_line: {
				type: 'number',
				description: 'Start line of code to extract (1-indexed)',
			},
			end_line: {
				type: 'number',
				description: 'End line of code to extract (1-indexed)',
			},
		},
		required: ['path', 'function_name', 'start_line', 'end_line'],
	}),
	needsApproval: true, // Extract function is a destructive operation
	execute: async (args, _options) => {
		return await executeExtractFunction(args);
	},
});

const ExtractFunctionFormatter = React.memo(
	({args, result}: {args: ExtractFunctionArgs; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext required');
		}
		const {colors} = themeContext;

		const language = getFileLanguage(args.path);

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ lsp_extract_function</Text>

				<Box>
					<Text color={colors.secondary}>Path: </Text>
					<Text color={colors.text}>{args.path}</Text>
					{language !== 'Unknown' && (
						<>
							<Text color={colors.text}> </Text>
							<Text color={colors.info}>({language})</Text>
						</>
					)}
				</Box>

				<Box>
					<Text color={colors.secondary}>Function name: </Text>
					<Text color={colors.primary}>{args.function_name}</Text>
				</Box>

				<Box>
					<Text color={colors.secondary}>Lines: </Text>
					<Text color={colors.text}>
						{args.start_line} - {args.end_line}
					</Text>
				</Box>
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const extractFunctionFormatter = (
	args: ExtractFunctionArgs,
	result?: string,
): React.ReactElement => {
	return <ExtractFunctionFormatter args={args} result={result} />;
};

const extractFunctionValidator = async (
	args: ExtractFunctionArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	// Validate path boundary to prevent directory traversal
	if (!isValidFilePath(args.path)) {
		return {
			valid: false,
			error: `⚒ Invalid file path: "${args.path}". Path must be relative and within the project directory.`,
		};
	}

	// Verify the resolved path stays within project boundaries
	try {
		const cwd = process.cwd();
		resolveFilePath(args.path, cwd);
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		return {
			valid: false,
			error: `⚒ Path validation failed: ${errorMessage}`,
		};
	}

	const absPath = resolvePath(args.path);

	try {
		await access(absPath, constants.F_OK);
	} catch {
		return {
			valid: false,
			error: `⚒ File not found: "${args.path}"`,
		};
	}

	if (!args.function_name || args.function_name.trim().length === 0) {
		return {valid: false, error: '⚒ Function name cannot be empty'};
	}

	// Check if function name is a valid identifier
	const validIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
	if (!validIdentifier.test(args.function_name)) {
		return {
			valid: false,
			error: `⚒ '${args.function_name}' is not a valid function name`,
		};
	}

	if (args.start_line < 1) {
		return {valid: false, error: '⚒ start_line must be >= 1'};
	}

	if (args.end_line < args.start_line) {
		return {valid: false, error: '⚒ end_line must be >= start_line'};
	}

	// Validate line range against file length (read file once)
	try {
		const fileContent = await getCachedFileContent(absPath);
		const totalLines = fileContent.lines.length;

		if (args.start_line > totalLines) {
			return {
				valid: false,
				error: `⚒ start_line (${args.start_line}) exceeds file length (${totalLines} lines)`,
			};
		}

		if (args.end_line > totalLines) {
			return {
				valid: false,
				error: `⚒ end_line (${args.end_line}) exceeds file length (${totalLines} lines)`,
			};
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		return {
			valid: false,
			error: `⚒ Cannot read file "${args.path}": ${errorMessage}`,
		};
	}

	return {valid: true};
};

export const extractFunctionTool: NanocoderToolExport = {
	name: 'lsp_extract_function' as const,
	tool: extractFunctionCoreTool,
	formatter: extractFunctionFormatter,
	validator: extractFunctionValidator,
};
