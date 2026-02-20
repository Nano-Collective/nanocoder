import {constants, existsSync} from 'node:fs';
import {access, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {highlight} from 'cli-highlight';
import {Box, Text} from 'ink';
import React from 'react';
import stripAnsi from 'strip-ansi';

import ToolMessage from '@/components/tool-message';
import {isNanocoderToolAlwaysAllowed} from '@/config/nanocoder-tools-config';
import {DEFAULT_TERMINAL_COLUMNS} from '@/constants';
import {getCurrentMode} from '@/context/mode-context';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {getCachedFileContent, invalidateCache} from '@/utils/file-cache';
import {normalizeIndentation} from '@/utils/indentation-normalizer';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';
import {getLanguageFromExtension} from '@/utils/programming-language-helper';
import {calculateTokens} from '@/utils/token-calculator';
import {ensureString} from '@/utils/type-helpers';
import {
	closeDiffInVSCode,
	isVSCodeConnected,
	sendFileChangeToVSCode,
} from '@/vscode/index';

const executeWriteFile = async (args: {
	path: string;
	content: unknown; // Note: change type to unknown to accept non-string
}): Promise<string> => {
	const absPath = resolve(args.path);
	const fileExists = existsSync(absPath);

	// Type guard: ensure content is string for write operation
	// Storage is safe (fs.writeFile ensures string-only), but we need to convert for safety
	const contentStr = ensureString(args.content);

	await writeFile(absPath, contentStr, 'utf-8');

	// Invalidate cache after write
	invalidateCache(absPath);

	// Read back to verify and show actual content
	const actualContent = await readFile(absPath, 'utf-8');
	const lines = actualContent.split('\n');
	const lineCount = lines.length;
	const charCount = actualContent.length;
	const estimatedTokens = calculateTokens(actualContent);

	// Generate full file contents to show the model the current file state
	let fileContext = '\n\nFile contents after write:\n';
	for (let i = 0; i < lines.length; i++) {
		const lineNumStr = String(i + 1).padStart(4, ' ');
		const line = lines[i] || '';
		fileContext += `${lineNumStr}: ${line}\n`;
	}

	const action = fileExists ? 'overwritten' : 'written';
	return `File ${action} successfully (${lineCount} lines, ${charCount} characters, ~${estimatedTokens} tokens).${fileContext}`;
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
				description:
					'The complete content to write to the file. Objects/arrays will be converted to JSON strings for storage.',
			},
		},
		required: ['path', 'content'],
	}),
	// Medium risk: file write operation, requires approval except in auto-accept mode or if configured in nanocoderTools.alwaysAllow
	needsApproval: () => {
		// Check if this tool is configured to always be allowed
		if (isNanocoderToolAlwaysAllowed('write_file')) {
			return false;
		}

		const mode = getCurrentMode();
		return mode !== 'auto-accept'; // true in normal/plan, false in auto-accept
	},
	execute: async (args, _options) => {
		return await executeWriteFile(args);
	},
});

interface WriteFileArgs {
	path?: string;
	file_path?: string;
	content?: string;
}

// Truncate a string with ANSI codes to fit terminal width (visual chars)
const truncateAnsi = (str: string, maxWidth: number): string => {
	const plainText = stripAnsi(str);
	if (plainText.length <= maxWidth) return str;

	let visibleCount = 0;
	const ansiRegex = /\x1b\[[0-9;]*m/g;
	let result = '';
	let lastIndex = 0;

	let match: RegExpExecArray | null;
	while ((match = ansiRegex.exec(str)) !== null) {
		const textBefore = str.slice(lastIndex, match.index);
		for (const char of textBefore) {
			if (visibleCount >= maxWidth - 1) break;
			result += char;
			visibleCount++;
		}
		if (visibleCount >= maxWidth - 1) break;
		result += match[0];
		lastIndex = match.index + match[0].length;
	}

	if (visibleCount < maxWidth - 1) {
		const remaining = str.slice(lastIndex);
		for (const char of remaining) {
			if (visibleCount >= maxWidth - 1) break;
			result += char;
			visibleCount++;
		}
	}

	return result + '\x1b[0m…';
};

// Create a component that will re-render when theme changes
const WriteFileFormatter = React.memo(({args}: {args: WriteFileArgs}) => {
	const themeContext = React.useContext(ThemeContext);
	if (!themeContext) {
		throw new Error('ThemeContext is required');
	}
	const {colors} = themeContext;
	const path = args.path || args.file_path || 'unknown';
	const newContent = args.content || '';
	const lineCount = newContent.split('\n').length;
	const charCount = newContent.length;

	// Estimate tokens (rough approximation: ~4 characters per token)
	const estimatedTokens = calculateTokens(newContent);

	// Normalize indentation for display
	const lines = newContent.split('\n');
	const normalizedLines = normalizeIndentation(lines);

	// Calculate available width for line content (terminal width - line number prefix - padding)
	const terminalWidth = process.stdout.columns || DEFAULT_TERMINAL_COLUMNS;
	const lineNumPrefixWidth = 6; // "1234 " = 5 chars + 1 for safety
	const availableWidth = Math.max(terminalWidth - lineNumPrefixWidth - 2, 20);

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>⚒ write_file</Text>

			<Box>
				<Text color={colors.secondary}>Path: </Text>
				<Text color={colors.text}>{path}</Text>
			</Box>
			<Box>
				<Text color={colors.secondary}>Size: </Text>
				<Text color={colors.text}>
					{lineCount} lines, {charCount} characters (~{estimatedTokens} tokens)
				</Text>
			</Box>

			{newContent.length > 0 ? (
				<Box flexDirection="column" marginTop={1}>
					<Text color={colors.text}>File content:</Text>
					{normalizedLines.map((line: string, i: number) => {
						const lineNumStr = String(i + 1).padStart(4, ' ');
						const ext = path.split('.').pop()?.toLowerCase() ?? '';
						const language = getLanguageFromExtension(ext);

						try {
							const highlighted = highlight(line, {language, theme: 'default'});
							const truncated = truncateAnsi(highlighted, availableWidth);
							return (
								<Box key={i}>
									<Text color={colors.secondary}>{lineNumStr} </Text>
									<Text wrap="truncate-end">{truncated}</Text>
								</Box>
							);
						} catch {
							const truncated =
								line.length > availableWidth
									? line.slice(0, availableWidth - 1) + '…'
									: line;
							return (
								<Box key={i}>
									<Text color={colors.secondary}>{lineNumStr} </Text>
									<Text wrap="truncate-end">{truncated}</Text>
								</Box>
							);
						}
					})}
				</Box>
			) : (
				<Box marginTop={1}>
					<Text color={colors.secondary}>File will be empty</Text>
				</Box>
			)}
		</Box>
	);

	return <ToolMessage message={messageContent} hideBox={true} />;
});

// Track VS Code change IDs for cleanup
const vscodeChangeIds = new Map<string, string>();

const writeFileFormatter = async (
	args: WriteFileArgs,
	result?: string,
): Promise<React.ReactElement> => {
	const path = args.path || args.file_path || '';
	const absPath = resolve(path);

	// Send diff to VS Code during preview phase (before execution)
	if (result === undefined && isVSCodeConnected()) {
		const content = args.content || '';

		// Get original content if file exists (use cache if available)
		let originalContent = '';
		if (existsSync(absPath)) {
			try {
				const cached = await getCachedFileContent(absPath);
				originalContent = cached.content;
			} catch {
				// File might exist but not be readable
			}
		}

		const changeId = sendFileChangeToVSCode(
			absPath,
			originalContent,
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

	return <WriteFileFormatter args={args} />;
};

const writeFileValidator = async (args: {
	path: string;
	content: unknown;
}): Promise<{valid: true} | {valid: false; error: string}> => {
	// Validate path boundary first to prevent directory traversal
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

	const absPath = resolve(args.path);

	// Check if parent directory exists
	const parentDir = dirname(absPath);
	try {
		await access(parentDir, constants.F_OK);
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error) {
			if (error.code === 'ENOENT') {
				return {
					valid: false,
					error: `⚒ Parent directory does not exist: "${parentDir}"`,
				};
			}
		}
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		return {
			valid: false,
			error: `⚒ Cannot access parent directory "${parentDir}": ${errorMessage}`,
		};
	}

	// Check if content is valid (not null/undefined)
	if (args.content === null || args.content === undefined) {
		return {
			valid: false,
			error: `⚒ Invalid content: content cannot be null or undefined.`,
		};
	}

	// Convert content to string for validation (but preserve type in memory)
	const _contentStr = ensureString(args.content);

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
				error: `⚒ Cannot write files to system directory: "${args.path}"`,
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
};
