import {constants, existsSync} from 'node:fs';
import {access, lstat, open, readFile, realpath, stat} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage, {CappedLines} from '@/components/tool-message';
import {getSyntaxTheme} from '@/config/themes';
import {DEFAULT_TERMINAL_COLUMNS} from '@/constants';
import {
	enforceFirewall,
	evaluateMutationEnvelope,
	getFirewallConfig,
} from '@/firewall/mutation-firewall';
import {ThemeContext} from '@/hooks/useTheme';
import {getSafeSessionCwd} from '@/services/session-cwd';
import {truncateAnsi} from '@/terminal/ansi-truncate';
import {highlight} from '@/terminal/highlighter';
import {normalizeIndentation} from '@/terminal/indentation-normalizer';
import {
	collapseUnchangedLines,
	computeLineDiff,
} from '@/tools/file-ops/inline-diff';
import {fitContentToLineEndings} from '@/tools/file-ops/line-endings';
import {
	validateEditableEncoding,
	validateEditableFormat,
	validatePath,
} from '@/tools/file-ops/path-validators';
import {getLanguageFromExtension} from '@/tools/file-ops/programming-language-helper';
import {
	forgetFileState,
	forgetReadContent,
	forgetVisibilityReceipt,
	hasFileSnapshot,
	hasSeenFile,
	hasVisibleLines,
	markFileSeen,
	matchesFileSnapshot,
	matchesVisibilityContent,
	recordVisibilityReceipt,
	rememberFileSnapshot,
} from '@/tools/runtime/read-tracker';
import {createFileToolApproval} from '@/tools/runtime/tool-approval';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {atomicWriteUserFile} from '@/utils/fs/atomic-write';
import {getCachedFileContent, invalidateCache} from '@/utils/fs/file-cache';
import {estimateTokens} from '@/utils/token-calculator';
import {truncateText} from '@/utils/truncate-text';
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

/** Check the full snapshot when present; otherwise verify scoped visibility and version. */
async function matchesCurrentReadState(
	absPath: string,
	expectedTargetPath?: string,
): Promise<boolean> {
	try {
		if (
			expectedTargetPath !== undefined &&
			(await realpath(absPath)) !== expectedTargetPath
		) {
			return false;
		}

		if (!hasFileSnapshot(absPath)) {
			const initialStats = await stat(absPath);
			const cached = await getCachedFileContent(absPath);
			let handle: Awaited<ReturnType<typeof open>> | undefined;
			try {
				handle = await open(absPath, 'r');
				const fileStats = await handle.stat();
				const content = await handle.readFile();
				const currentStats = await stat(absPath);
				if (
					initialStats.dev !== fileStats.dev ||
					initialStats.ino !== fileStats.ino ||
					initialStats.mtimeMs !== fileStats.mtimeMs ||
					initialStats.size !== fileStats.size ||
					fileStats.dev !== currentStats.dev ||
					fileStats.ino !== currentStats.ino ||
					fileStats.mtimeMs !== currentStats.mtimeMs ||
					fileStats.size !== currentStats.size
				) {
					return false;
				}
				// The cache is process-wide, but visible ranges are agent-scoped.
				// Compare against the digest captured with this scope's read receipt.
				if (matchesVisibilityContent(absPath, content) === false) return false;
				const allLines = Array.from(
					{length: cached.totalLines},
					(_, index) => index + 1,
				);
				if (!hasVisibleLines(absPath, currentStats, allLines).visible)
					return false;
				return (
					expectedTargetPath === undefined ||
					(await realpath(absPath)) === expectedTargetPath
				);
			} finally {
				await handle?.close().catch(() => {});
			}
		}

		let handle: Awaited<ReturnType<typeof open>> | undefined;
		try {
			handle = await open(absPath, 'r');
			const fileStats = await handle.stat();
			const content = await handle.readFile();
			const pathStats = await stat(absPath);
			if (fileStats.dev !== pathStats.dev || fileStats.ino !== pathStats.ino) {
				return false;
			}
			if (
				expectedTargetPath !== undefined &&
				(await realpath(absPath)) !== expectedTargetPath
			) {
				return false;
			}
			return matchesFileSnapshot(absPath, content) === true;
		} finally {
			await handle?.close().catch(() => {});
		}
	} catch {
		return false;
	}
}

function invalidateStaleReadState(absPath: string): void {
	forgetFileState(absPath);
	invalidateCache(absPath);
}

function staleSnapshotError(path: string): string {
	return `File "${path}" has changed since it was read. Re-read its current contents with read_file using explicit start_line and end_line ranges; if it is large, continue with the range suggested by the preview before overwriting it.`;
}

function staleReadError(path: string, absPath: string): string {
	if (!existsSync(absPath)) {
		return `File "${path}" is no longer available at this path after it was read. This write was blocked to avoid silently recreating a missing target. Confirm the path's state; retry only if you intend to create the file.`;
	}
	return staleSnapshotError(path);
}

const executeWriteFile = async (args: {
	path: string;
	content: unknown; // Note: change type to unknown to accept non-string
}): Promise<string> => {
	const formatResult = validateEditableFormat(args.path);
	if (!formatResult.valid) {
		throw new Error(formatResult.error);
	}

	const absPath = resolve(getSafeSessionCwd(), args.path);
	const fileExists = existsSync(absPath);
	if (!fileExists && hasSeenFile(absPath)) {
		invalidateStaleReadState(absPath);
		throw new Error(staleReadError(args.path, absPath));
	}

	if (fileExists) {
		let cached: Awaited<ReturnType<typeof getCachedFileContent>> | undefined;
		try {
			cached = await getCachedFileContent(absPath);
		} catch {
			// Unreadable: no diff, and no encoding to check.
		}
		previousContentCache.set(absPath, cached?.content ?? null);
		// The model saw this file decoded as UTF-8, so a rewrite carries U+FFFD
		// for every byte that didn't decode, the same loss the edit tools refuse.
		if (cached) {
			const encodingResult = validateEditableEncoding(args.path, cached);
			if (!encodingResult.valid) {
				throw new Error(encodingResult.error);
			}
		}
	} else {
		previousContentCache.set(absPath, null);
	}

	// Type guard: ensure content is string for write operation
	// Storage is safe (fs.writeFile ensures string-only), but we need to convert for safety
	const contentStr = ensureString(args.content);
	let originalContent = '';
	if (fileExists) {
		const cached = previousContentCache.get(absPath);
		if (cached !== null && cached !== undefined) {
			originalContent = cached;
		} else {
			try {
				originalContent = await readFile(absPath, 'utf-8');
				previousContentCache.set(absPath, originalContent);
			} catch (readError) {
				const fwConfig = getFirewallConfig();
				if (fwConfig.enabled && fwConfig.mode !== 'disabled') {
					throw new Error(
						`[Mutation Firewall] Blocked mutation: failed to read existing file '${args.path}' for validation: ${formatError(readError)}`,
					);
				}
			}
		}
	}

	// Keep a CRLF file CRLF when the model sends LF content.
	const content = fitContentToLineEndings(
		fileExists ? originalContent : null,
		contentStr,
	);

	const firewallResult = evaluateMutationEnvelope(
		args.path,
		originalContent,
		content,
	);
	const firewallWarning = enforceFirewall(firewallResult);

	let expectedTargetPath: string | undefined;
	if (fileExists) {
		if (!(await matchesCurrentReadState(absPath))) {
			invalidateStaleReadState(absPath);
			throw new Error(staleReadError(args.path, absPath));
		}
		expectedTargetPath = await realpath(absPath);
	}

	await atomicWriteUserFile(absPath, content, async targetPath => {
		if (!fileExists) {
			// Do not turn a path that appeared while the approval UI was open into
			// an unreviewed overwrite.
			if (existsSync(absPath)) {
				throw new Error(
					`File "${args.path}" appeared after this write was approved. Read it before overwriting it.`,
				);
			}
			return;
		}

		if (
			targetPath !== expectedTargetPath ||
			!(await matchesCurrentReadState(absPath, targetPath))
		) {
			invalidateStaleReadState(absPath);
			throw new Error(staleReadError(args.path, absPath));
		}
	});

	// Invalidate cache after write
	invalidateCache(absPath);
	// The file's contents are now known to the model (it just wrote them), so a
	// follow-up edit or rewrite is not blind.
	markFileSeen(absPath);
	forgetReadContent(absPath);
	// Record full-file visibility receipt since the model just wrote all content
	forgetVisibilityReceipt(absPath);
	try {
		const stats = await lstat(absPath);
		// Full file visibility (undefined start/end means entire file)
		recordVisibilityReceipt(absPath, stats, undefined, undefined, content);
	} catch {
		// If stat fails, fall back to file-level tracking only
	}

	// Read back to verify the write succeeded (but don't echo the content back
	// to the model — it just sent us that exact content as the tool call
	// arguments, so returning it again is pure duplication).
	const actualBytes = await readFile(absPath);
	const actualContent = actualBytes.toString('utf-8');
	// Store the content we committed, not a later external edit that raced with
	// the read-back.
	rememberFileSnapshot(absPath, content);
	const lineCount = actualContent.split('\n').length;
	const charCount = actualContent.length;
	const estimatedTokens = estimateTokens(actualContent);

	const action = fileExists ? 'overwritten' : 'written';
	return `File ${action} successfully (${lineCount} lines, ${charCount} characters, ~${estimatedTokens} tokens).${firewallWarning}`;
};

const writeFileCoreTool = tool({
	description:
		'Write content to a file (creates new file or overwrites existing file). Use this for complete file rewrites, generated code, or when most of the file needs to change. For small targeted edits, use string_replace instead.',
	inputSchema: jsonSchema<{
		path: string;
		content: unknown;
		description?: string;
	}>({
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
			description: {
				type: 'string',
				description:
					'Optional brief summary of the intent or purpose of this file write.',
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
	description?: string;
}

/** Truncate a plain (non-highlighted) line to fit terminal width */
const truncateLine = (line: string, maxWidth: number): string =>
	truncateText(line, maxWidth, {unit: 'code-units'});

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
		// Show the content as it lands on disk, so a CRLF file is not shown
		// as every line changed.
		const newContent = fitContentToLineEndings(
			previousContent,
			ensureString(args.content),
		);
		const lineCount = newContent.split('\n').length;
		const charCount = newContent.length;
		const ext = path.split('.').pop()?.toLowerCase() ?? '';
		const language = getLanguageFromExtension(ext);

		// Estimate tokens (rough approximation: ~4 characters per token)
		const estimatedTokens = estimateTokens(newContent);

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

				{args.description && (
					<Box flexDirection="column">
						<Text color={colors.secondary}>Description:</Text>
						<Text color={colors.text}> {args.description}</Text>
					</Box>
				)}

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
		const content = fitContentToLineEndings(
			previousContent,
			args.content || '',
		);

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

	const formatResult = validateEditableFormat(args.path);
	if (!formatResult.valid) return formatResult;

	const absPath = resolve(getSafeSessionCwd(), args.path);
	if (!existsSync(absPath) && hasSeenFile(absPath)) {
		invalidateStaleReadState(absPath);
		return {valid: false, error: staleReadError(args.path, absPath)};
	}

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

	// Line-level visibility check for overwrites: if the file exists and has been
	// seen at the file level, ensure the agent has actually read the content
	// being overwritten. This prevents partial reads followed by blind overwrites.
	if (existsSync(absPath) && hasSeenFile(absPath)) {
		try {
			const stats = await lstat(absPath);
			const cached = await getCachedFileContent(absPath);
			const totalLines = cached.content.split('\n').length;

			// Check if all lines in the existing file have been seen
			const allLines = Array.from({length: totalLines}, (_, i) => i + 1);
			const visibilityCheck = hasVisibleLines(absPath, stats, allLines);

			if (!visibilityCheck.visible) {
				return {
					valid: false,
					error: `You are overwriting "${args.path}" but haven't read all of its content. ${visibilityCheck.error} Read the entire file before overwriting, or use string_replace for targeted edits.`,
				};
			}
		} catch {
			// If visibility check fails (file deleted, etc.), fall back to file-level
			// check which already passed. This preserves backward compatibility.
		}
	}

	// Overwriting a legacy-encoded file: see executeWriteFile.
	if (existsSync(absPath)) {
		try {
			const cached = await getCachedFileContent(absPath);
			const encodingResult = validateEditableEncoding(args.path, cached);
			if (!encodingResult.valid) return encodingResult;
		} catch {
			// Unreadable files surface their own error at execute time.
		}
	}

	if (existsSync(absPath)) {
		const snapshotMatches = await matchesCurrentReadState(absPath);
		if (!snapshotMatches) {
			invalidateStaleReadState(absPath);
			return {
				valid: false,
				error: staleReadError(args.path, absPath),
			};
		}
	}

	// Allow empty strings (intentional file creation)
	// Only reject null/undefined, which we already checked above

	return {valid: true};
};

export const writeFileTool: NanocoderToolExport = {
	name: 'write_file' as const,
	tool: writeFileCoreTool,
	formatter: writeFileFormatter,
	validator: writeFileValidator,
	approval: createFileToolApproval('write_file'),
};
