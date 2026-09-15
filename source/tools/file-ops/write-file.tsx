import {constants, existsSync} from 'node:fs';
import {access, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {highlight} from 'cli-highlight';
import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage, {CappedLines} from '@/components/tool-message';
import {getSyntaxTheme} from '@/config/themes';
import {DEFAULT_TERMINAL_COLUMNS} from '@/constants';
import {ThemeContext} from '@/hooks/useTheme';
import {getSafeSessionCwd} from '@/services/session-cwd';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {truncateAnsi} from '@/utils/ansi-truncate';
import {formatError} from '@/utils/error-formatter';
import {getCachedFileContent, invalidateCache} from '@/utils/file-cache';
import {normalizeIndentation} from '@/utils/indentation-normalizer';
import {collapseUnchangedLines, computeLineDiff} from '@/utils/inline-diff';
import {validatePath} from '@/utils/path-validators';
import {getLanguageFromExtension} from '@/utils/programming-language-helper';
import {hasSeenFile, markFileSeen} from '@/utils/read-tracker';
import {calculateTokens} from '@/utils/token-calculator';
import {createFileToolApproval} from '@/utils/tool-approval';
import {ensureString} from '@/utils/type-helpers';
import {
	closeDiffInVSCode,
	isVSCodeConnected,
	sendFileChangeToVSCode,
} from '@/vscode/index';

// Captures each file's pre-write content, keyed by absolute path, so the
// tool-result formatter can still render a diff after execute() overwrites
// the file on disk. Populated here (covers auto-accept/yolo, where the
// confirmation preview never renders) and, redundantly but harmlessly, by
// the preview-phase formatter below (covers a rejected call, where execute()
// never runs).
const previousContentCache = new Map<string, string | null>();

const executeWriteFile = async (args: {
	path: string;
	content: unknown; // Note: change type to unknown to accept non-string
}): Promise<string> => {
	const absPath = resolve(getSafeSessionCwd(), args.path);
	const fileExists = existsSync(absPath);

	if (fileExists) {
		try {
			const cached = await getCachedFileContent(absPath);
			previousContentCache.set(absPath, cached.content);
		} catch {
			previousContentCache.set(absPath, null);
		}
	} else {
		previousContentCache.set(absPath, null);
	}

	// Type guard: ensure content is string for write operation
	// Storage is safe (fs.writeFile ensures string-only), but we need to convert for safety
	const contentStr = ensureString(args.content);

	await writeFile(absPath, contentStr, 'utf-8');

	// Invalidate cache after write
	invalidateCache(absPath);
	// The file's contents are now known to the model (it just wrote them), so a
	// follow-up edit or rewrite is not blind.
	markFileSeen(absPath);

	// Read back to verify the write succeeded (but don't echo the content back
	// to the model — it just sent us that exact content as the tool call
	// arguments, so returning it again is pure duplication).
	const actualContent = await readFile(absPath, 'utf-8');
	const lineCount = actualContent.split('\n').length;
	const charCount = actualContent.length;
	const estimatedTokens = calculateTokens(actualContent);

	const action = fileExists ? 'overwritten' : 'written';
	return `File ${action} successfully (${lineCount} lines, ${charCount} characters, ~${estimatedTokens} tokens).`;
};

const writeFileCoreTool = tool({
	description:
		'Write content to a file (creates new file or overwrites existing file). Use this for complete file rewrites, generated code, or when most of the file needs to change. For small targeted edits, use string_replace instead.',
	inputSchema: jsonSchema<{path: string; content: unknown}>({
		// Note: change to unknown
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The path to the file to write.',
			},
			content: {
				type: 'string', // Guide LLM to send strings
				description: 'The complete content to write to the file.',
			},
		},
		required: ['path', 'content'],
	}),
	execute: async (args, _options) => {
		return await executeWriteFile(args);
	},
});

interface WriteFileArgs {
	path?: string;
	file_path?: string;
	content?: string;
}

/** Truncate a plain (non-highlighted) line to fit terminal width */
const truncateLine = (line: string, maxWidth: number): string => {
	if (line.length <= maxWidth) return line;
	return line.slice(0, maxWidth - 1) + '…';
};

// Create a component that will re-render when theme changes
const WriteFileFormatter = React.memo(
	({
		args,
		previousContent,
	}: {
		args: WriteFileArgs;
		previousContent: string | null;
	}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext is required');
		}
		const {colors} = themeContext;
		const path = args.path || args.file_path || 'unknown';
		const newContent = ensureString(args.content);
		const lineCount = newContent.split('\n').length;
		const charCount = newContent.length;
		const ext = path.split('.').pop()?.toLowerCase() ?? '';
		const language = getLanguageFromExtension(ext);

		// Estimate tokens (rough approximation: ~4 characters per token)
		const estimatedTokens = calculateTokens(newContent);

		// Calculate available width for line content (terminal width - line number prefix - padding)
		const terminalWidth = process.stdout.columns || DEFAULT_TERMINAL_COLUMNS;

		const isDiff = previousContent !== null && previousContent !== newContent;

		const body = isDiff ? (
			(() => {
				const diffLineNumPrefixWidth = 8; // "1234 - " = 7 chars + 1 for safety
				const availableWidth = Math.max(
					terminalWidth - diffLineNumPrefixWidth - 2,
					20,
				);
				const entries = computeLineDiff(previousContent as string, newContent);
				const addedCount = entries.filter(e => e.type === 'added').length;
				const removedCount = entries.filter(e => e.type === 'removed').length;
				// Collapse untouched stretches so the line cap never spends its
				// budget on unchanged lines while hiding the edits themselves.
				const rows = collapseUnchangedLines(entries);

				return (
					<Box flexDirection="column" marginTop={1}>
						<Box>
							<Text color={colors.text}>Diff: </Text>
							<Text color={colors.diffAddedText}>+{addedCount}</Text>
							<Text color={colors.text}> </Text>
							<Text color={colors.diffRemovedText}>-{removedCount}</Text>
						</Box>
						<Box flexDirection="column">
							<CappedLines
								items={rows}
								isChange={entry =>
									entry.type === 'added' || entry.type === 'removed'
								}
								renderItem={(entry, i) => {
									if (entry.type === 'gap') {
										return (
											<Text key={i} color={colors.secondary}>
												{`   ⋯ ${entry.count} unchanged line${entry.count === 1 ? '' : 's'}`}
											</Text>
										);
									}

									if (entry.type === 'unchanged') {
										const lineNumStr = String(entry.newLine).padStart(4, ' ');
										let displayLine: string;
										try {
											displayLine = truncateAnsi(
												highlight(entry.text, {
													language,
													theme: getSyntaxTheme(colors),
												}),
												availableWidth,
											);
										} catch {
											displayLine = truncateLine(entry.text, availableWidth);
										}
										return (
											<Box key={i}>
												<Text color={colors.secondary}>{lineNumStr} </Text>
												<Text wrap="truncate-end">{displayLine}</Text>
											</Box>
										);
									}

									if (entry.type === 'removed') {
										const lineNumStr = String(entry.oldLine).padStart(4, ' ');
										return (
											<Box key={i}>
												<Text
													backgroundColor={colors.diffRemoved}
													color={colors.diffRemovedText}
												>
													{lineNumStr} -
												</Text>
												<Text
													wrap="truncate-end"
													backgroundColor={colors.diffRemoved}
													color={colors.diffRemovedText}
												>
													{truncateLine(entry.text, availableWidth)}
												</Text>
											</Box>
										);
									}

									const lineNumStr = String(entry.newLine).padStart(4, ' ');
									return (
										<Box key={i}>
											<Text
												backgroundColor={colors.diffAdded}
												color={colors.diffAddedText}
											>
												{lineNumStr} +
											</Text>
											<Text
												wrap="truncate-end"
												backgroundColor={colors.diffAdded}
												color={colors.diffAddedText}
											>
												{truncateLine(entry.text, availableWidth)}
											</Text>
										</Box>
									);
								}}
							/>
						</Box>
					</Box>
				);
			})()
		) : newContent.length > 0 ? (
			(() => {
				const lineNumPrefixWidth = 6; // "1234 " = 5 chars + 1 for safety
				const availableWidth = Math.max(
					terminalWidth - lineNumPrefixWidth - 2,
					20,
				);
				const lines = newContent.split('\n');
				const normalizedLines = normalizeIndentation(lines);

				return (
					<Box flexDirection="column" marginTop={1}>
						<Text color={colors.text}>File content:</Text>
						<CappedLines
							items={normalizedLines}
							renderItem={(line: string, i: number) => {
								const lineNumStr = String(i + 1).padStart(4, ' ');

								try {
									const highlighted = highlight(line, {
										language,
										theme: getSyntaxTheme(colors),
									});
									const truncated = truncateAnsi(highlighted, availableWidth);
									return (
										<Box key={i}>
											<Text color={colors.secondary}>{lineNumStr} </Text>
											<Text wrap="truncate-end">{truncated}</Text>
										</Box>
									);
								} catch {
									const truncated = truncateLine(line, availableWidth);
									return (
										<Box key={i}>
											<Text color={colors.secondary}>{lineNumStr} </Text>
											<Text wrap="truncate-end">{truncated}</Text>
										</Box>
									);
								}
							}}
						/>
					</Box>
				);
			})()
		) : (
			<Box marginTop={1}>
				<Text color={colors.secondary}>File will be empty</Text>
			</Box>
		);

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ write_file</Text>

				<Box>
					<Text color={colors.secondary}>Path: </Text>
					<Text wrap="truncate-end" color={colors.text}>
						{path}
					</Text>
				</Box>
				<Box>
					<Text color={colors.secondary}>Size: </Text>
					<Text color={colors.text}>
						{lineCount} lines, {charCount} characters (~{estimatedTokens}{' '}
						tokens)
					</Text>
				</Box>

				{body}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

// Track VS Code change IDs for cleanup
const vscodeChangeIds = new Map<string, string>();

const writeFileFormatter = async (
	args: WriteFileArgs,
	result?: string,
): Promise<React.ReactElement> => {
	const path = args.path || args.file_path || '';
	const absPath = resolve(getSafeSessionCwd(), path);

	let previousContent: string | null;
	if (result === undefined) {
		previousContent = null;
		if (existsSync(absPath)) {
			try {
				const cached = await getCachedFileContent(absPath);
				previousContent = cached.content;
			} catch {
				// File might exist but not be readable; fall back to full-dump rendering.
			}
		}
		previousContentCache.set(absPath, previousContent);
	} else {
		previousContent = previousContentCache.get(absPath) ?? null;
		previousContentCache.delete(absPath);
	}

	// Send diff to VS Code during preview phase (before execution)
	if (result === undefined && isVSCodeConnected()) {
		const content = args.content || '';

		const changeId = sendFileChangeToVSCode(
			absPath,
			previousContent ?? '',
			content,
			'write_file',
			{
				path,
				content,
			},
		);
		if (changeId) {
			vscodeChangeIds.set(absPath, changeId);
		}
	} else if (result !== undefined && isVSCodeConnected()) {
		// Tool was executed (confirmed or rejected), close the diff
		const changeId = vscodeChangeIds.get(absPath);
		if (changeId) {
			closeDiffInVSCode(changeId);
			vscodeChangeIds.delete(absPath);
		}
	}

	return <WriteFileFormatter args={args} previousContent={previousContent} />;
};

const writeFileValidator = async (args: {
	path: string;
	content: unknown;
}): Promise<{valid: true} | {valid: false; error: string}> => {
	const pathResult = validatePath(args.path);
	if (!pathResult.valid) return pathResult;

	const absPath = resolve(getSafeSessionCwd(), args.path);

	// Check if parent directory exists
	const parentDir = dirname(absPath);
	try {
		await access(parentDir, constants.F_OK);
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error) {
			if (error.code === 'ENOENT') {
				return {
					valid: false,
					error: `Parent directory does not exist: "${parentDir}"`,
				};
			}
		}
		const errorMessage = formatError(error);
		return {
			valid: false,
			error: `Cannot access parent directory "${parentDir}": ${errorMessage}`,
		};
	}

	// Check if content is valid (not null/undefined)
	if (args.content === null || args.content === undefined) {
		return {
			valid: false,
			error: `Invalid content: content cannot be null or undefined.`,
		};
	}

	// Read-before-overwrite: refuse to clobber an existing file the model has
	// not seen this session. Creating new files is always allowed; rewriting a
	// file the model has already read (or previously written) is allowed. This
	// preserves the legitimate read-then-rewrite path while blocking blind
	// overwrites that would destroy contents the model never looked at.
	if (existsSync(absPath) && !hasSeenFile(absPath)) {
		return {
			valid: false,
			error: `"${args.path}" already exists and you have not read it this session. Call read_file on it first — if the file is over 300 lines, specify start_line and end_line to read its actual content, not just metadata — so you don't discard existing content, then retry. For small changes, prefer string_replace over a full overwrite.`,
		};
	}

	// Allow empty strings (intentional file creation)
	// Only reject null/undefined, which we already checked above

	// Check for invalid path characters or attempts to write to system directories
	const invalidPatterns = [
		/^\/etc\//i,
		/^\/sys\//i,
		/^\/proc\//i,
		/^\/dev\//i,
		/^\/boot\//i,
		/^C:\\Windows\\/i,
		/^C:\\Program Files\\/i,
	];

	for (const pattern of invalidPatterns) {
		if (pattern.test(absPath)) {
			return {
				valid: false,
				error: `Cannot write files to system directory: "${args.path}"`,
			};
		}
	}

	return {valid: true};
};

export const writeFileTool: NanocoderToolExport = {
	name: 'write_file' as const,
	tool: writeFileCoreTool,
	formatter: writeFileFormatter,
	validator: writeFileValidator,
	approval: createFileToolApproval('write_file'),
};
