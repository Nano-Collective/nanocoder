import {constants} from 'node:fs';
import {
	access,
	copyFile,
	mkdtemp,
	rm,
	unlink,
	writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve as resolvePath} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import type {WorkspaceEdit} from '@/lsp/protocol';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {getCachedFileContent, invalidateCache} from '@/utils/file-cache';
import {executeToolWithErrorHandling} from '@/utils/lsp-error-handling';
import {requireLSPInitialized} from '@/utils/lsp-manager-helper';
import {getFileLanguage} from '@/utils/lsp-protocol-utils';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';
import {isVSCodeConnected, sendFileChangeToVSCode} from '@/vscode/index';

interface RenameSymbolArgs {
	path: string;
	line: number;
	character: number;
	new_name: string;
}

const applyWorkspaceEdit = async (
	edit: WorkspaceEdit,
	args: RenameSymbolArgs,
): Promise<void> => {
	if (edit.changes) {
		// Create temporary directory for backups
		const backupDir = await mkdtemp(join(tmpdir(), 'nanocoder-rename-'));
		const backups: Map<string, string> = new Map();

		try {
			// Phase 1: Create backups of all files to modify
			for (const uri of Object.keys(edit.changes)) {
				const filePath = uri.replace('file://', '');
				const backupPath = join(
					backupDir,
					`${filePath.replace(/\//g, '_')}.backup`,
				);

				// Create parent directories if needed
				const backupDirPath = backupPath.split('/').slice(0, -1).join('/');
				await mkdtemp(backupDirPath + '-');

				// Copy file to backup
				await copyFile(filePath, backupPath);
				backups.set(filePath, backupPath);
			}

			// Phase 2: Apply all edits
			for (const [uri, edits] of Object.entries(edit.changes)) {
				const filePath = uri.replace('file://', '');
				const fileContent = await getCachedFileContent(filePath);
				const lines = fileContent.content.split('\n');

				// Apply edits in reverse order to maintain line/column positions
				for (const textEdit of [...edits].reverse()) {
					const {start, end} = textEdit.range;

					if (start.line === end.line) {
						// Single-line edit
						lines[start.line] =
							lines[start.line].substring(0, start.character) +
							textEdit.newText +
							lines[start.line].substring(end.character);
					} else {
						// Multi-line edit
						const firstLine = lines[start.line].substring(0, start.character);
						const lastLine = lines[end.line].substring(end.character);
						lines.splice(
							start.line,
							end.line - start.line + 1,
							firstLine + textEdit.newText + lastLine,
						);
					}
				}

				await writeFile(filePath, lines.join('\n'), 'utf-8');
				invalidateCache(filePath);

				// Notify VS Code about the change
				if (isVSCodeConnected()) {
					try {
						sendFileChangeToVSCode(
							filePath,
							fileContent.content,
							lines.join('\n'),
							'lsp_rename_symbol',
							{
								path: args.path,
								line: args.line,
								character: args.character,
								new_name: args.new_name,
							},
						);
					} catch {
						// Ignore VS Code notification errors
					}
				}
			}

			// Phase 3: All edits succeeded, delete backups
			for (const backupPath of backups.values()) {
				try {
					await unlink(backupPath);
				} catch {
					// Ignore backup cleanup errors
				}
			}
		} catch (error) {
			// Phase 4: Rollback - restore all files from backups
			for (const [filePath, backupPath] of backups.entries()) {
				try {
					await copyFile(backupPath, filePath);
					invalidateCache(filePath);
				} catch {
					// Continue with other files even if one fails
				}
			}

			// Clean up backup directory
			try {
				await rm(backupDir, {recursive: true, force: true});
			} catch {
				// Ignore cleanup errors
			}

			throw error;
		}

		// Clean up backup directory
		try {
			await rm(backupDir, {recursive: true, force: true});
		} catch {
			// Ignore cleanup errors
		}
	}
};

/**
 * Executes the rename symbol operation using LSP with transaction support.
 *
 * @param args - Tool arguments including file path, position, and new symbol name
 * @returns Promise resolving to a formatted string with rename summary
 * @throws Error if LSP is not initialized, validation fails, or the operation fails
 *
 * @example
 * const result = await executeRenameSymbol({
 *   path: 'src/app.ts',
 *   line: 10,
 *   character: 5,
 *   new_name: 'newFunctionName'
 * });
 *
 * @description
 * This function performs a safe rename operation with:
 * - Backup creation for all files before modification
 * - Automatic rollback on any error
 * - Multi-file reference updates
 * - VS Code integration for change notification
 */
const executeRenameSymbol = async (args: RenameSymbolArgs): Promise<string> => {
	return executeToolWithErrorHandling(async () => {
		const lspManager = await requireLSPInitialized();

		// Validate new name
		if (!args.new_name || args.new_name.trim().length === 0) {
			throw new Error('New name cannot be empty');
		}

		// Check if new name is a valid identifier
		const validIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
		if (!validIdentifier.test(args.new_name)) {
			throw new Error(`'${args.new_name}' is not a valid identifier name`);
		}

		const workspaceEdit = await lspManager.renameSymbol(
			args.path,
			args.line,
			args.character,
			args.new_name,
		);

		if (
			!workspaceEdit.changes ||
			Object.keys(workspaceEdit.changes).length === 0
		) {
			return `No changes needed. Symbol is already named '${args.new_name}' or could not be renamed.`;
		}

		// Count total changes
		let totalChanges = 0;
		for (const edits of Object.values(workspaceEdit.changes)) {
			totalChanges += edits.length;
		}

		// Apply the workspace edit
		await applyWorkspaceEdit(workspaceEdit, args);

		// Generate summary
		let output = `Renamed symbol to '${args.new_name}'.\n\n`;
		output += `Modified ${Object.keys(workspaceEdit.changes).length} file${Object.keys(workspaceEdit.changes).length === 1 ? '' : 's'} `;
		output += `with ${totalChanges} change${totalChanges === 1 ? '' : 's'}:\n\n`;

		for (const [uri, edits] of Object.entries(workspaceEdit.changes)) {
			const filePath = uri.replace('file://', '');
			output += `${filePath}: ${edits.length} change${edits.length === 1 ? '' : 's'}\n`;
		}

		return output.trim();
	});
};

const renameSymbolCoreTool = tool({
	description:
		'Rename a symbol (variable, function, class, etc.) across all files in the workspace. Updates all references automatically.\n\n' +
		'Example: Rename a function from "oldName" to "newName" and all references across the codebase will be updated.\n\n' +
		'Usage: Place cursor on the symbol to rename and provide its position (line, character) and the new name. The tool will find all references and update them automatically.',
	inputSchema: jsonSchema<RenameSymbolArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'File path containing the symbol to rename',
			},
			line: {
				type: 'number',
				description: 'Symbol line number (1-indexed)',
			},
			character: {
				type: 'number',
				description: 'Symbol column number (1-indexed)',
			},
			new_name: {
				type: 'string',
				description: 'New name for the symbol',
			},
		},
		required: ['path', 'line', 'character', 'new_name'],
	}),
	needsApproval: true, // Renaming is a destructive operation
	execute: async (args, _options) => {
		return await executeRenameSymbol(args);
	},
});

const RenameSymbolFormatter = React.memo(
	({args, result}: {args: RenameSymbolArgs; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext required');
		}
		const {colors} = themeContext;

		let changeCount = 0;
		let fileCount = 0;
		if (result && !result.startsWith('Error:')) {
			const fileMatch = result.match(/Modified (\d+) file/);
			const changeMatch = result.match(/with (\d+) change/);
			if (fileMatch) fileCount = parseInt(fileMatch[1], 10);
			if (changeMatch) changeCount = parseInt(changeMatch[1], 10);
		}

		const language = getFileLanguage(args.path);

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ lsp_rename_symbol</Text>

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

				<Box>
					<Text color={colors.secondary}>New name: </Text>
					<Text color={colors.primary}>{args.new_name}</Text>
				</Box>

				{result && fileCount > 0 && (
					<>
						<Box>
							<Text color={colors.secondary}>Modified: </Text>
							<Text color={colors.primary}>
								{fileCount} file{fileCount === 1 ? '' : 's'}
							</Text>
						</Box>
						<Box>
							<Text color={colors.secondary}>Changes: </Text>
							<Text color={colors.primary}>
								{changeCount} change{changeCount === 1 ? '' : 's'}
							</Text>
						</Box>
					</>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const renameSymbolFormatter = (
	args: RenameSymbolArgs,
	result?: string,
): React.ReactElement => {
	return <RenameSymbolFormatter args={args} result={result} />;
};

const renameSymbolValidator = async (
	args: RenameSymbolArgs,
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

	if (!args.new_name || args.new_name.trim().length === 0) {
		return {valid: false, error: '⚒ New name cannot be empty'};
	}

	// Check if new name is a valid identifier
	const validIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
	if (!validIdentifier.test(args.new_name)) {
		return {
			valid: false,
			error: `⚒ '${args.new_name}' is not a valid identifier name`,
		};
	}

	return {valid: true};
};

export const renameSymbolTool: NanocoderToolExport = {
	name: 'lsp_rename_symbol' as const,
	tool: renameSymbolCoreTool,
	formatter: renameSymbolFormatter,
	validator: renameSymbolValidator,
};
