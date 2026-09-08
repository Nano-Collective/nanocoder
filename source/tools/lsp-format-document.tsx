import {constants} from 'node:fs';
import {access, readFile, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage from '@/components/tool-message';
import {ThemeContext} from '@/hooks/useTheme';
import {
	type FormattingOptions,
	getLSPManager,
	type TextEdit,
} from '@/lsp/index';
import {getProjectRoot, getSafeSessionCwd} from '@/services/session-cwd';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {invalidateCache} from '@/utils/file-cache';
import {validatePath} from '@/utils/path-validators';
import {markFileSeen} from '@/utils/read-tracker';
import {createFileToolApproval} from '@/utils/tool-approval';

interface FormatDocumentArgs {
	path: string;
	/** Override indent width. Defaults from nearest .editorconfig when present. */
	tabSize?: number;
	/** Override spaces vs tabs. Defaults from nearest .editorconfig when present. */
	insertSpaces?: boolean;
}

export type FormatOptions = Pick<FormattingOptions, 'tabSize' | 'insertSpaces'>;

/** Minimal LSP surface used by format orchestration — keeps execute testable. */
export type FormatLspManager = {
	isInitialized(): boolean;
	hasLanguageSupport(filePath: string): boolean;
	supportsDocumentFormatting(filePath: string): boolean;
	openDocument(filePath: string): Promise<boolean>;
	formatDocument(
		filePath: string,
		options?: Partial<FormattingOptions>,
	): Promise<TextEdit[]>;
	updateDocument(filePath: string, content: string): boolean;
};

/**
 * Convert an LSP Position to a UTF-16 code-unit offset in `text`.
 * Character is clamped to the end of its line so sentinel "end of line"
 * values from servers do not swallow following lines.
 */
export function positionToOffset(
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

	let lineEnd = i;
	while (lineEnd < text.length && text[lineEnd] !== '\n') {
		lineEnd++;
	}

	// Exclude CR from the line body when the ending is CRLF.
	let contentEnd = lineEnd;
	if (contentEnd > i && text[contentEnd - 1] === '\r') {
		contentEnd--;
	}

	const clampedChar = Math.min(Math.max(0, character), contentEnd - i);
	return i + clampedChar;
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

function globMatches(pattern: string, fileName: string): boolean {
	if (pattern === '*') return true;

	// One-level brace expansion: *.{ts,tsx} → *.ts | *.tsx
	const brace = pattern.match(/^(.*)\{([^}]+)\}(.*)$/);
	if (brace) {
		return brace[2]
			.split(',')
			.some(alt =>
				globMatches(`${brace[1]}${alt.trim()}${brace[3]}`, fileName),
			);
	}

	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*')
		.replace(/\?/g, '.');
	return new RegExp(`^${escaped}$`).test(fileName);
}

/** Split EditorConfig section headers on commas that are not inside `{...}`. */
function splitSectionPatterns(header: string): string[] {
	const parts: string[] = [];
	let current = '';
	let depth = 0;
	for (const ch of header) {
		if (ch === '{') depth++;
		if (ch === '}') depth = Math.max(0, depth - 1);
		if (ch === ',' && depth === 0) {
			if (current.trim()) parts.push(current.trim());
			current = '';
			continue;
		}
		current += ch;
	}
	if (current.trim()) parts.push(current.trim());
	return parts;
}

/**
 * Resolve indent options from the nearest `.editorconfig`, then apply any
 * explicit tool-arg overrides. Falls back to spaces/2 only when nothing else
 * is available (matching the previous LSP client default).
 */
export async function resolveFormatOptions(
	filePath: string,
	overrides?: Partial<FormatOptions>,
): Promise<FormatOptions> {
	const fromConfig = await readEditorConfigIndent(filePath);
	return {
		tabSize:
			typeof overrides?.tabSize === 'number' && overrides.tabSize > 0
				? Math.floor(overrides.tabSize)
				: (fromConfig?.tabSize ?? 2),
		insertSpaces:
			typeof overrides?.insertSpaces === 'boolean'
				? overrides.insertSpaces
				: (fromConfig?.insertSpaces ?? true),
	};
}

async function readEditorConfigIndent(
	filePath: string,
): Promise<FormatOptions | null> {
	const projectRoot = getProjectRoot();
	let dir = dirname(resolve(filePath));
	const fileName = basename(filePath);

	while (true) {
		const configPath = join(dir, '.editorconfig');
		try {
			const content = await readFile(configPath, 'utf-8');
			const parsed = parseEditorConfigIndent(content, fileName);
			if (parsed) return parsed;
			if (/^\s*root\s*=\s*true\s*$/im.test(content)) return null;
		} catch {
			// Missing / unreadable — keep walking up.
		}

		if (dir === projectRoot || dirname(dir) === dir) {
			return null;
		}
		dir = dirname(dir);
	}
}

/** Parse indent_style / indent_size for `fileName` from one .editorconfig body. */
export function parseEditorConfigIndent(
	content: string,
	fileName: string,
): FormatOptions | null {
	let currentMatch = false;
	let indentStyle: 'tab' | 'space' | undefined;
	let indentSize: number | undefined;

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.replace(/[#;].*$/, '').trim();
		if (!line) continue;

		const section = line.match(/^\[(.+)\]$/);
		if (section) {
			const patterns = splitSectionPatterns(section[1]);
			currentMatch = patterns.some(pattern => globMatches(pattern, fileName));
			continue;
		}

		if (!currentMatch) continue;

		const kv = line.match(/^([^=]+)=(.*)$/);
		if (!kv) continue;
		const key = kv[1].trim().toLowerCase();
		const value = kv[2].trim().toLowerCase();

		if (key === 'indent_style') {
			if (value === 'tab' || value === 'space') indentStyle = value;
		} else if (key === 'indent_size' || key === 'tab_width') {
			const size = Number.parseInt(value, 10);
			if (Number.isFinite(size) && size > 0) indentSize = size;
		}
	}

	if (!indentStyle && indentSize === undefined) return null;

	return {
		insertSpaces: indentStyle ? indentStyle === 'space' : true,
		tabSize: indentSize ?? (indentStyle === 'tab' ? 4 : 2),
	};
}

/**
 * Format `absPath` via the given LSP manager and write changes to disk.
 * `displayPath` is used in user-facing messages (usually the relative arg).
 */
export async function formatFileWithLsp(
	absPath: string,
	displayPath: string,
	manager: FormatLspManager,
	options?: Partial<FormatOptions>,
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

	if (!manager.supportsDocumentFormatting(absPath)) {
		return `Language server for ${displayPath} does not support document formatting.`;
	}

	const formatOptions = await resolveFormatOptions(absPath, options);
	const edits = await manager.formatDocument(absPath, formatOptions);
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
	return formatFileWithLsp(absPath, args.path, manager, {
		tabSize: args.tabSize,
		insertSpaces: args.insertSpaces,
	});
};

const formatDocumentCoreTool = tool({
	description:
		'Format a source file using the language server for its file type. Applies project-style formatting from .editorconfig when present (override with tabSize/insertSpaces) and writes the result to disk. Prefer this over guessing a formatter CLI via execute_bash.',
	inputSchema: jsonSchema<FormatDocumentArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Path to the file to format.',
			},
			tabSize: {
				type: 'number',
				description:
					'Indent width passed to the language server. Defaults from nearest .editorconfig.',
			},
			insertSpaces: {
				type: 'boolean',
				description:
					'true for spaces, false for tabs. Defaults from nearest .editorconfig.',
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

	if (
		args.tabSize !== undefined &&
		(typeof args.tabSize !== 'number' ||
			!Number.isFinite(args.tabSize) ||
			args.tabSize <= 0)
	) {
		return {
			valid: false,
			error: 'tabSize must be a positive number when provided.',
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
