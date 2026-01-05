import {constants} from 'node:fs';
import {access} from 'node:fs/promises';
import {resolve as resolvePath} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {getCurrentMode} from '@/context/mode-context';
import {ThemeContext} from '@/hooks/useTheme';
import type {DocumentSymbol, SymbolInformation} from '@/lsp/protocol';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {executeToolWithErrorHandling} from '@/utils/lsp-error-handling';
import {requireLSPInitialized} from '@/utils/lsp-manager-helper';
import {formatSymbol, getFileLanguage} from '@/utils/lsp-protocol-utils';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

interface DocumentSymbolsArgs {
	path: string;
	kind?: string;
}

/**
 * Executes the document symbols operation using LSP.
 *
 * @param args - Tool arguments including file path and optional kind filter
 * @returns Promise resolving to a formatted string listing all symbols found
 * @throws Error if LSP is not initialized or the operation fails
 *
 * @example
 * const result = await executeDocumentSymbols({
 *   path: 'src/app.ts',
 *   kind: 'Function'  // Optional: filter to only functions
 * });
 */
const executeDocumentSymbols = async (
	args: DocumentSymbolsArgs,
): Promise<string> => {
	return executeToolWithErrorHandling(async () => {
		const lspManager = await requireLSPInitialized();

		const symbols = await lspManager.getDocumentSymbols(args.path);

		if (symbols.length === 0) {
			return `No symbols found in ${args.path}`;
		}

		// Validate and convert symbol kind filter
		let filterKind: number | undefined;
		if (args.kind) {
			// Convert string kind to enum number
			const kindMap: Record<string, number> = {
				File: 1,
				Module: 2,
				Namespace: 3,
				Package: 4,
				Class: 5,
				Method: 6,
				Property: 7,
				Field: 8,
				Constructor: 9,
				Enum: 10,
				Interface: 11,
				Function: 12,
				Variable: 13,
				Constant: 14,
				String: 15,
				Number: 16,
				Boolean: 17,
				Array: 18,
				Object: 19,
				Key: 20,
				Null: 21,
				EnumMember: 22,
				Struct: 23,
				Event: 24,
				Operator: 25,
				TypeParameter: 26,
			};

			filterKind = kindMap[args.kind];
			if (filterKind === undefined) {
				const validKinds = Object.keys(kindMap).join(', ');
				return `Error: Invalid symbol kind '${args.kind}'. Valid kinds: ${validKinds}`;
			}
		}

		let output = `Found ${symbols.length} symbol${symbols.length === 1 ? '' : 's'} in ${args.path}:\n\n`;

		// Check if we have hierarchical symbols (DocumentSymbol) or flat (SymbolInformation)
		const isHierarchical = 'children' in symbols[0];

		if (isHierarchical) {
			// Hierarchical format - filter recursively
			for (const symbol of symbols as DocumentSymbol[]) {
				output += formatSymbolRecursively(symbol, filterKind, 0);
			}
		} else {
			// Flat format
			for (const symbol of symbols as SymbolInformation[]) {
				if (filterKind && symbol.kind !== filterKind) {
					continue;
				}
				output += formatSymbol(symbol) + '\n';
			}
		}

		return output.trim();
	});
};

const formatSymbolRecursively = (
	symbol: DocumentSymbol,
	filterKind: number | undefined,
	indent: number,
): string => {
	let output = '';

	if (filterKind && symbol.kind !== filterKind) {
		if (symbol.children) {
			for (const child of symbol.children) {
				output += formatSymbolRecursively(child, filterKind, indent);
			}
		}
		return output;
	}

	output += formatSymbol(symbol, indent) + '\n';

	if (symbol.children) {
		for (const child of symbol.children) {
			output += formatSymbolRecursively(child, filterKind, indent + 1);
		}
	}

	return output;
};

const documentSymbolsCoreTool = tool({
	description:
		'Get document symbols (classes, functions, variables, etc.) for a file. Can filter by symbol kind (e.g., "Function", "Class", "Method").\n\n' +
		'Example: List all functions in a file to understand its structure, or find all classes to navigate the codebase.\n\n' +
		'Usage: Provide a file path to get all symbols. Optionally filter by kind (e.g., "Function", "Class", "Method") to see only specific symbol types.',
	inputSchema: jsonSchema<DocumentSymbolsArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'File path to analyze',
			},
			kind: {
				type: 'string',
				description:
					'Filter by symbol kind (e.g., "Function", "Class", "Method", "Variable")',
			},
		},
		required: ['path'],
	}),
	needsApproval: () => {
		const mode = getCurrentMode();
		return mode !== 'auto-accept'; // true in normal/plan, false in auto-accept
	},
	execute: async (args, _options) => {
		return await executeDocumentSymbols(args);
	},
});

const DocumentSymbolsFormatter = React.memo(
	({args, result}: {args: DocumentSymbolsArgs; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext required');
		}
		const {colors} = themeContext;

		let symbolCount = 0;
		if (result && !result.startsWith('Error:')) {
			const match = result.match(/Found (\d+) symbol/);
			if (match) symbolCount = parseInt(match[1], 10);
		}

		const language = getFileLanguage(args.path);

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ lsp_document_symbols</Text>

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

				{args.kind && (
					<Box>
						<Text color={colors.secondary}>Filter: </Text>
						<Text color={colors.text}>{args.kind}</Text>
					</Box>
				)}

				{result && symbolCount > 0 && (
					<Box>
						<Text color={colors.secondary}>Found: </Text>
						<Text color={colors.primary}>
							{symbolCount} symbol{symbolCount === 1 ? '' : 's'}
						</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const documentSymbolsFormatter = (
	args: DocumentSymbolsArgs,
	result?: string,
): React.ReactElement => {
	return <DocumentSymbolsFormatter args={args} result={result} />;
};

const documentSymbolsValidator = async (
	args: DocumentSymbolsArgs,
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

	return {valid: true};
};

export const documentSymbolsTool: NanocoderToolExport = {
	name: 'lsp_document_symbols' as const,
	tool: documentSymbolsCoreTool,
	formatter: documentSymbolsFormatter,
	validator: documentSymbolsValidator,
};
