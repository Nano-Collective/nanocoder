import {constants} from 'node:fs';
import {access} from 'node:fs/promises';
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
import {formatLocation, getFileLanguage} from '@/utils/lsp-protocol-utils';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

interface FindReferencesArgs {
	path: string;
	line: number;
	character: number;
	include_declaration?: boolean;
}

/**
 * Executes the find references operation using LSP.
 *
 * @param args - Tool arguments including file path, line, character, and optional include_declaration flag
 * @returns Promise resolving to a formatted string listing all references found
 * @throws Error if LSP is not initialized or the operation fails
 *
 * @example
 * const result = await executeFindReferences({
 *   path: 'src/app.ts',
 *   line: 10,
 *   character: 5,
 *   include_declaration: true
 * });
 */
const executeFindReferences = async (
	args: FindReferencesArgs,
): Promise<string> => {
	return executeToolWithErrorHandling(async () => {
		const lspManager = await requireLSPInitialized();

		const references = await lspManager.findReferences(
			args.path,
			args.line,
			args.character,
			args.include_declaration !== false,
		);

		if (references.length === 0) {
			return `No references found for symbol at ${args.path}:${args.line}:${args.character}`;
		}

		let output = `Found ${references.length} reference${references.length === 1 ? '' : 's'}:\n\n`;

		for (const ref of references) {
			output += formatLocation(ref) + '\n';
		}

		return output.trim();
	});
};

const findReferencesCoreTool = tool({
	description:
		'Find all references to a symbol across the codebase. Returns file paths and line numbers for each usage.\n\n' +
		"Example: Find all usages of a function or variable to understand where it's used before refactoring.\n\n" +
		'Usage: Place cursor on the symbol and provide its position (line, character). The tool will list all files and locations where the symbol is referenced.',
	inputSchema: jsonSchema<FindReferencesArgs>({
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
			include_declaration: {
				type: 'boolean',
				description: 'Include the definition location (default: true)',
			},
		},
		required: ['path', 'line', 'character'],
	}),
	needsApproval: () => {
		const mode = getCurrentMode();
		return mode !== 'auto-accept'; // true in normal/plan, false in auto-accept
	},
	execute: async (args, _options) => {
		return await executeFindReferences(args);
	},
});

const FindReferencesFormatter = React.memo(
	({args, result}: {args: FindReferencesArgs; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext required');
		}
		const {colors} = themeContext;

		let refCount = 0;
		if (result && !result.startsWith('Error:')) {
			const match = result.match(/Found (\d+) reference/);
			if (match) refCount = parseInt(match[1], 10);
		}

		const language = getFileLanguage(args.path);

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ lsp_find_references</Text>

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

				{result && refCount > 0 && (
					<Box>
						<Text color={colors.secondary}>Found: </Text>
						<Text color={colors.primary}>
							{refCount} reference{refCount === 1 ? '' : 's'}
						</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const findReferencesFormatter = (
	args: FindReferencesArgs,
	result?: string,
): React.ReactElement => {
	return <FindReferencesFormatter args={args} result={result} />;
};

const findReferencesValidator = async (
	args: FindReferencesArgs,
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

export const findReferencesTool: NanocoderToolExport = {
	name: 'lsp_find_references' as const,
	tool: findReferencesCoreTool,
	formatter: findReferencesFormatter,
	validator: findReferencesValidator,
};
