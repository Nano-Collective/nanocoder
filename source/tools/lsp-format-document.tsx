import {constants} from 'node:fs';
import {access, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import {getLSPManager, type TextEdit} from '@/lsp/index';
import {getSafeSessionCwd} from '@/services/session-cwd';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {invalidateCache} from '@/utils/file-cache';
import {validatePath} from '@/utils/path-validators';
import {markFileSeen} from '@/utils/read-tracker';
import {createFileToolApproval} from '@/utils/tool-approval';

interface FormatDocumentArgs {
	path: string;
}

/** Minimal LSP surface used by format orchestration — keeps execute testable. */
export type FormatLspManager = {
	isInitialized(): boolean;
	hasLanguageSupport(filePath: string): boolean;
	openDocument(filePath: string): Promise<boolean>;
	formatDocument(filePath: string): Promise<TextEdit[]>;
	updateDocument(filePath: string, content: string): boolean;
};

/**
 * Convert an LSP Position to a UTF-16-agnostic byte offset in `text`.
 * Line endings (`\n` / `\r\n`) are walked as in the open document content.
 */
function positionToOffset(
	text: string,
	line: number,
	character: number,
): number {
	let currentLine = 0;
	let i = 0;
	while (i < text.length && currentLine < line) {
		if (text[i] === '\n') {
			currentLine++;
		}
		i++;
	}
	return Math.min(i + Math.max(0, character), text.length);
}

/**
 * Apply LSP TextEdit[] to a document string.
 * Edits are applied bottom-to-top so earlier ranges stay valid.
 */
export function applyTextEdits(content: string, edits: TextEdit[]): string {
	const sorted = [...edits].sort((a, b) => {
		if (a.range.start.line !== b.range.start.line) {
			return b.range.start.line - a.range.start.line;
		}
		if (a.range.start.character !== b.range.start.character) {
			return b.range.start.character - a.range.start.character;
		}
		if (a.range.end.line !== b.range.end.line) {
			return b.range.end.line - a.range.end.line;
		}
		return b.range.end.character - a.range.end.character;
	});

	let result = content;
	for (const edit of sorted) {
		const start = positionToOffset(
			result,
			edit.range.start.line,
			edit.range.start.character,
		);
		const end = positionToOffset(
			result,
			edit.range.end.line,
			edit.range.end.character,
		);
		if (start > end) continue;
		result = result.slice(0, start) + edit.newText + result.slice(end);
	}
	return result;
}

/**
 * Format `absPath` via the given LSP manager and write changes to disk.
 * `displayPath` is used in user-facing messages (usually the relative arg).
 */
export async function formatFileWithLsp(
	absPath: string,
	displayPath: string,
	manager: FormatLspManager,
): Promise<string> {
	if (!manager.isInitialized()) {
		return 'No language server available. Install a language server for this file type, or run with --vscode.';
	}

	if (!manager.hasLanguageSupport(absPath)) {
		return `No language server available for file type: ${displayPath}.`;
	}

	const opened = await manager.openDocument(absPath);
	if (!opened) {
		return `Language server for ${displayPath} is not ready.`;
	}

	const edits = await manager.formatDocument(absPath);
	if (edits.length === 0) {
		return `No formatting changes needed for ${displayPath}.`;
	}

	const original = await readFile(absPath, 'utf-8');
	const formatted = applyTextEdits(original, edits);

	if (formatted === original) {
		return `No formatting changes needed for ${displayPath}.`;
	}

	await writeFile(absPath, formatted, 'utf-8');
	invalidateCache(absPath);
	markFileSeen(absPath);
	manager.updateDocument(absPath, formatted);

	const editLabel = edits.length === 1 ? '1 edit' : `${edits.length} edits`;
	return `Formatted ${displayPath} (${editLabel} applied).`;
}

const executeFormatDocument = async (
	args: FormatDocumentArgs,
): Promise<string> => {
	const absPath = resolve(getSafeSessionCwd(), args.path);
	const manager = await getLSPManager();
	return formatFileWithLsp(absPath, args.path, manager);
};

const formatDocumentCoreTool = tool({
	description:
		'Format a source file using the language server for its file type. Applies project-style formatting (indentation, trailing whitespace, etc.) and writes the result to disk. Prefer this over guessing a formatter CLI via execute_bash.',
	inputSchema: jsonSchema<FormatDocumentArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Path to the file to format.',
			},
		},
		required: ['path'],
	}),
	execute: async args => {
		return await executeFormatDocument(args);
	},
});

const FormatDocumentFormatter = React.memo(
	({args, result}: {args: FormatDocumentArgs; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error(
				'FormatDocumentFormatter must be used within a ThemeProvider',
			);
		}
		const {colors} = themeContext;

		const applied =
			typeof result === 'string' && result.startsWith('Formatted ');
		const unchanged =
			typeof result === 'string' &&
			result.startsWith('No formatting changes needed');

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ format_document</Text>

				<Box>
					<Text color={colors.secondary}>Path: </Text>
					<Text wrap="truncate-end" color={colors.text}>
						{args.path}
					</Text>
				</Box>

				{result && (
					<Box>
						<Text color={colors.secondary}>Result: </Text>
						<Text
							color={
								applied
									? colors.success
									: unchanged
										? colors.text
										: colors.warning
							}
						>
							{result}
						</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const formatDocumentFormatter = (
	args: FormatDocumentArgs,
	result?: string,
): React.ReactElement => {
	return <FormatDocumentFormatter args={args} result={result} />;
};

const formatDocumentValidator = async (
	args: FormatDocumentArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	if (!args.path || typeof args.path !== 'string' || args.path.trim() === '') {
		return {
			valid: false,
			error: 'path is required. Provide the file to format.',
		};
	}

	const pathResult = validatePath(args.path);
	if (!pathResult.valid) return pathResult;

	const absPath = resolve(getSafeSessionCwd(), args.path);

	try {
		await access(absPath, constants.F_OK);
		return {valid: true};
	} catch (error: unknown) {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			return {
				valid: false,
				error: `File "${args.path}" does not exist. Please verify the file path and try again.`,
			};
		}
		const errorMessage = formatError(error);
		return {
			valid: false,
			error: `Cannot access file "${args.path}": ${errorMessage}`,
		};
	}
};

export const formatDocumentTool: NanocoderToolExport = {
	name: 'lsp_format_document' as const,
	tool: formatDocumentCoreTool,
	formatter: formatDocumentFormatter,
	validator: formatDocumentValidator,
	approval: createFileToolApproval('lsp_format_document'),
};
