import {constants} from 'node:fs';
import {access, readFile} from 'node:fs/promises';
import {resolve as resolvePath} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {getCurrentMode} from '@/context/mode-context';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {executeToolWithErrorHandling} from '@/utils/lsp-error-handling';
import {requireLSPInitialized} from '@/utils/lsp-manager-helper';
import {
	formatLocation,
	getFileLanguage,
	positionToDisplay,
} from '@/utils/lsp-protocol-utils';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

interface GoToDefinitionArgs {
	path: string;
	line: number;
	character: number;
}

/**
 * Executes the go to definition operation using LSP.
 *
 * @param args - Tool arguments including file path, line, and character position
 * @returns Promise resolving to a formatted string with definition location(s) and code preview
 * @throws Error if LSP is not initialized or the operation fails
 *
 * @example
 * const result = await executeGoToDefinition({
 *   path: 'src/app.ts',
 *   line: 10,
 *   character: 5
 * });
 */
const executeGoToDefinition = async (
	args: GoToDefinitionArgs,
): Promise<string> => {
	return executeToolWithErrorHandling(async () => {
		const lspManager = await requireLSPInitialized();

		const definition = await lspManager.goToDefinition(
			args.path,
			args.line,
			args.character,
		);

		if (!definition) {
			return `No definition found for symbol at ${args.path}:${args.line}:${args.character}`;
		}

		// Handle both single Location and array of Locations
		const locations = Array.isArray(definition) ? definition : [definition];

		if (locations.length === 0) {
			return `No definition found for symbol at ${args.path}:${args.line}:${args.character}`;
		}

		let output = `Found ${locations.length} definition${locations.length === 1 ? '' : 's'}:\n\n`;

		for (const loc of locations) {
			output += formatLocation(loc) + '\n';

			// Try to read the file and show the definition line
			try {
				const filePath = loc.uri.replace('file://', '');
				const {line} = positionToDisplay(loc.range.start);
				const content = await readFile(filePath, 'utf-8');
				const lines = content.split('\n');
				const defLine = lines[line - 1]?.trim();
				if (defLine) {
					output += `  ${defLine}\n`;
				}
			} catch {
				// File might not exist or be readable
			}

			output += '\n';
		}

		return output.trim();
	});
};

const goToDefinitionCoreTool = tool({
	description:
		'Go to definition for a symbol. Returns file path, line number, column number, and a code preview of the definition.\n\n' +
		'Example: Navigate to where a function, class, or variable is defined to understand its implementation.\n\n' +
		'Usage: Place cursor on the symbol and provide its position (line, character). The tool will show the definition location and a preview of the code.',
	inputSchema: jsonSchema<GoToDefinitionArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'File path containing the symbol',
			},
			line: {
				type: 'number',
				description: 'Symbol line number (1-indexed)',
			},
			character: {
				type: 'number',
				description: 'Symbol column number (1-indexed)',
			},
		},
		required: ['path', 'line', 'character'],
	}),
	needsApproval: () => {
		const mode = getCurrentMode();
		return mode !== 'auto-accept'; // true in normal/plan, false in auto-accept
	},
	execute: async (args, _options) => {
		return await executeGoToDefinition(args);
	},
});

const GoToDefinitionFormatter = React.memo(
	({args, result}: {args: GoToDefinitionArgs; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext required');
		}
		const {colors} = themeContext;

		let defCount = 0;
		if (result && !result.startsWith('Error:')) {
			const match = result.match(/Found (\d+) definition/);
			if (match) defCount = parseInt(match[1], 10);
		}

		const language = getFileLanguage(args.path);

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ lsp_go_to_definition</Text>

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
					<Text color={colors.secondary}>Position: </Text>
					<Text color={colors.text}>
						line {args.line}, character {args.character}
					</Text>
				</Box>

				{result && defCount > 0 && (
					<Box>
						<Text color={colors.secondary}>Found: </Text>
						<Text color={colors.primary}>
							{defCount} definition{defCount === 1 ? '' : 's'}
						</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const goToDefinitionFormatter = (
	args: GoToDefinitionArgs,
	result?: string,
): React.ReactElement => {
	return <GoToDefinitionFormatter args={args} result={result} />;
};

const goToDefinitionValidator = async (
	args: GoToDefinitionArgs,
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

	if (args.line < 1) {
		return {valid: false, error: '⚒ Line must be >= 1'};
	}

	if (args.character < 1) {
		return {valid: false, error: '⚒ Character must be >= 1'};
	}

	return {valid: true};
};

export const goToDefinitionTool: NanocoderToolExport = {
	name: 'lsp_go_to_definition' as const,
	tool: goToDefinitionCoreTool,
	formatter: goToDefinitionFormatter,
	validator: goToDefinitionValidator,
};
