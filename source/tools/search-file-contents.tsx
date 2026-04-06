import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {
	BUFFER_FIND_FILES_BYTES,
	BUFFER_GREP_MULTIPLIER,
	DEFAULT_SEARCH_RESULTS,
	MAX_SEARCH_RESULTS,
} from '@/constants';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {DEFAULT_IGNORE_DIRS, loadGitignore} from '@/utils/gitignore-loader';
import {isValidFilePath} from '@/utils/path-validation';
import {calculateTokens} from '@/utils/token-calculator';

const execFileAsync = promisify(execFile);

const GREP_TIMEOUT_MS = 30_000;
const MAX_CONTEXT_LINES = 10;

interface SearchMatch {
	file: string;
	line: number;
	content: string;
}

/**
 * Search file contents using grep
 */
async function searchFileContents(
	query: string,
	cwd: string,
	maxResults: number,
	caseSensitive: boolean,
	include?: string,
	searchPath?: string,
	wholeWord?: boolean,
	contextLines?: number,
): Promise<{matches: SearchMatch[]; truncated: boolean}> {
	try {
		const ig = loadGitignore(cwd);

		// Build grep arguments array to prevent command injection
		const grepArgs: string[] = [
			'-rn', // recursive with line numbers
			'-E', // extended regex
			'-I', // skip binary files
		];

		// Add case sensitivity flag
		if (!caseSensitive) {
			grepArgs.push('-i');
		}

		// Add whole word matching
		if (wholeWord) {
			grepArgs.push('-w');
		}

		// Add context lines
		const hasContext = contextLines !== undefined && contextLines > 0;
		if (hasContext) {
			const clamped = Math.min(contextLines, MAX_CONTEXT_LINES);
			grepArgs.push('-C', `${clamped}`);
		}

		// Add include patterns
		if (include) {
			// Support brace expansion like "*.{ts,tsx}" → multiple --include args
			const braceMatch = include.match(/^\*\.\{(.+)\}$/);
			if (braceMatch) {
				for (const ext of braceMatch[1].split(',')) {
					grepArgs.push(`--include=*.${ext.trim()}`);
				}
			} else {
				grepArgs.push(`--include=${include}`);
			}
		} else {
			grepArgs.push('--include=*');
		}

		// Dynamically add exclusions from DEFAULT_IGNORE_DIRS
		for (const dir of DEFAULT_IGNORE_DIRS) {
			grepArgs.push(`--exclude-dir=${dir}`);
		}

		// Add the search query (no escaping needed with array-based args)
		grepArgs.push(query);

		// Add search path (scoped directory or cwd)
		if (searchPath) {
			grepArgs.push(searchPath);
		} else {
			grepArgs.push('.');
		}

		// Execute grep command with array-based arguments and timeout
		const {stdout} = await execFileAsync('grep', grepArgs, {
			cwd,
			maxBuffer: BUFFER_FIND_FILES_BYTES * BUFFER_GREP_MULTIPLIER,
			timeout: GREP_TIMEOUT_MS,
		});

		const matches: SearchMatch[] = [];
		const cwdPrefix = path.resolve(cwd) + path.sep;

		if (hasContext) {
			// Context mode: split by group separator (BSD grep default: --)
			const groups = stdout.trim().split('\n--\n');

			for (const group of groups) {
				const lines = group.split('\n').filter(Boolean);

				// First pass: find file path and line number from a match line
				let file = '';
				let lineNum = 0;
				for (const l of lines) {
					const matchLine =
						l.match(/^\.\/(.+?):(\d+):(.*)$/) || l.match(/^(.+?):(\d+):(.*)$/);
					if (matchLine) {
						let filePath = matchLine[1];
						if (path.isAbsolute(filePath)) {
							filePath = filePath.startsWith(cwdPrefix)
								? filePath.slice(cwdPrefix.length)
								: filePath;
						}
						file = filePath;
						lineNum = parseInt(matchLine[2], 10);
						break;
					}
				}

				if (!file) continue;
				if (ig.ignores(file)) continue;

				// Second pass: extract content from all lines using known file path
				const contentLines: string[] = [];
				for (const l of lines) {
					const prefix = l.startsWith('./') ? `./${file}` : file;
					if (l.startsWith(`${prefix}:`)) {
						const rest = l.slice(prefix.length + 1);
						const colonIdx = rest.indexOf(':');
						const num = rest.slice(0, colonIdx);
						const text = rest.slice(colonIdx + 1);
						contentLines.push(`${num}: ${text}`);
					} else if (l.startsWith(`${prefix}-`)) {
						const rest = l.slice(prefix.length + 1);
						const dashIdx = rest.indexOf('-');
						const num = rest.slice(0, dashIdx);
						const text = rest.slice(dashIdx + 1);
						contentLines.push(`${num}: ${text}`);
					}
				}

				// Higher content limit for context blocks
				const MAX_CONTEXT_CONTENT_LENGTH = 1500;
				let content = contentLines.join('\n');
				if (content.length > MAX_CONTEXT_CONTENT_LENGTH) {
					content = content.slice(0, MAX_CONTEXT_CONTENT_LENGTH) + '…';
				}

				matches.push({file, line: lineNum, content});
				if (matches.length >= maxResults) break;
			}
		} else {
			// Standard mode: parse line-by-line
			const lines = stdout.trim().split('\n').filter(Boolean);

			for (const line of lines) {
				// Match both relative (./path) and absolute (/abs/path) grep output
				const match =
					line.match(/^\.\/(.+?):(\d+):(.*)$/) ||
					line.match(/^(.+?):(\d+):(.*)$/);
				if (match) {
					// Normalize to relative path from cwd
					let filePath = match[1];
					if (path.isAbsolute(filePath)) {
						filePath = filePath.startsWith(cwdPrefix)
							? filePath.slice(cwdPrefix.length)
							: filePath;
					}

					// Skip files ignored by gitignore
					if (ig.ignores(filePath)) {
						continue;
					}

					// Truncate long lines to prevent token explosion
					const MAX_CONTENT_LENGTH = 300;
					let content = match[3].trim();
					if (content.length > MAX_CONTENT_LENGTH) {
						content = content.slice(0, MAX_CONTENT_LENGTH) + '…';
					}

					matches.push({
						file: filePath,
						line: parseInt(match[2], 10),
						content,
					});

					// Stop once we have enough matches
					if (matches.length >= maxResults) {
						break;
					}
				}
			}
		}

		return {
			matches,
			truncated: matches.length >= maxResults,
		};
	} catch (error: unknown) {
		// grep returns exit code 1 when no matches found
		if (error instanceof Error && 'code' in error && error.code === 1) {
			return {matches: [], truncated: false};
		}
		// Handle timeout
		if (
			error instanceof Error &&
			'killed' in error &&
			(error as NodeJS.ErrnoException & {killed?: boolean}).killed
		) {
			throw new Error(
				'Search timed out after 30 seconds. Try a more specific query or narrower path.',
			);
		}
		throw error;
	}
}

interface SearchFileContentsArgs {
	query: string;
	maxResults?: number;
	caseSensitive?: boolean;
	include?: string;
	path?: string;
	wholeWord?: boolean;
	contextLines?: number;
}

const executeSearchFileContents = async (
	args: SearchFileContentsArgs,
): Promise<string> => {
	// Validate query
	if (!args.query || !args.query.trim()) {
		return 'Error: Search query cannot be empty';
	}

	const cwd = process.cwd();
	const maxResults = Math.min(
		args.maxResults || DEFAULT_SEARCH_RESULTS,
		MAX_SEARCH_RESULTS,
	);
	const caseSensitive = args.caseSensitive || false;

	// Validate and resolve search path if provided
	let searchPath: string | undefined;
	if (args.path) {
		if (!isValidFilePath(args.path)) {
			return `Error: Invalid path "${args.path}"`;
		}
		searchPath = path.resolve(cwd, args.path);
		if (!searchPath.startsWith(path.resolve(cwd))) {
			return `Error: Path escapes project directory: ${args.path}`;
		}
	}

	try {
		const {matches, truncated} = await searchFileContents(
			args.query,
			cwd,
			maxResults,
			caseSensitive,
			args.include,
			searchPath,
			args.wholeWord,
			args.contextLines,
		);

		if (matches.length === 0) {
			return `No matches found for "${args.query}"`;
		}

		// Format results with clear file:line format
		let output = `Found ${matches.length} match${matches.length === 1 ? '' : 'es'}${truncated ? ` (showing first ${maxResults})` : ''}:\n\n`;

		for (const match of matches) {
			output += `${match.file}:${match.line}\n`;
			output += `  ${match.content}\n\n`;
		}

		return output.trim();
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		throw new Error(`Content search failed: ${errorMessage}`);
	}
};

const searchFileContentsCoreTool = tool({
	description:
		'Search for text or code inside files. Use this INSTEAD OF bash grep/rg/ag/ack commands. Supports extended regex (e.g., "foo|bar", "func(tion)?"). Returns file:line with matching content. Use to find: function definitions, variable usage, import statements, TODO comments. Case-insensitive by default (use caseSensitive=true for exact matching). Use include to filter by file type (e.g., "*.ts") and path to scope to a directory (e.g., "src/components"). Use wholeWord=true for exact word boundaries. Use contextLines to see surrounding code.',
	inputSchema: jsonSchema<SearchFileContentsArgs>({
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description:
					'Text or code to search for inside files. Supports extended regex (e.g., "foo|bar" for alternation, "func(tion)?" for optional groups). Examples: "handleSubmit", "import React", "TODO|FIXME", "export (interface|type)" (find type exports), "useState\\(" (find React hooks). Case-insensitive by default.',
			},
			maxResults: {
				type: 'number',
				description:
					'Maximum number of matches to return (default: 30, max: 100)',
			},
			caseSensitive: {
				type: 'boolean',
				description:
					'Whether to perform case-sensitive search (default: false)',
			},
			include: {
				type: 'string',
				description:
					'Glob pattern to filter which files are searched (e.g., "*.ts", "*.{ts,tsx}", "*.spec.ts"). Only files matching this pattern will be searched.',
			},
			path: {
				type: 'string',
				description:
					'Directory to scope the search to (relative path, e.g., "src/components", "source/tools"). Only files within this directory will be searched.',
			},
			wholeWord: {
				type: 'boolean',
				description:
					'Match whole words only, preventing partial matches (default: false). Useful for finding exact variable/function names.',
			},
			contextLines: {
				type: 'number',
				description:
					'Number of lines to show before and after each match (default: 0, max: 10). Useful for understanding surrounding code context.',
			},
		},
		required: ['query'],
	}),
	// Low risk: read-only operation, never requires approval
	needsApproval: false,
	execute: async (args, _options) => {
		return await executeSearchFileContents(args);
	},
});

interface SearchFileContentsFormatterProps {
	args: {
		query: string;
		maxResults?: number;
		caseSensitive?: boolean;
		include?: string;
		path?: string;
		wholeWord?: boolean;
		contextLines?: number;
	};
	result?: string;
}

const SearchFileContentsFormatter = React.memo(
	({args, result}: SearchFileContentsFormatterProps) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext not found');
		}
		const {colors} = themeContext;

		// Parse result to get match count
		let matchCount = 0;
		if (result && !result.startsWith('Error:')) {
			const firstLine = result.split('\n')[0];
			const matchFound = firstLine.match(/Found (\d+)/);
			if (matchFound) {
				matchCount = parseInt(matchFound[1], 10);
			}
		}

		// Calculate tokens
		const tokens = result ? calculateTokens(result) : 0;

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ search_file_contents</Text>

				<Box>
					<Text color={colors.secondary}>Query: </Text>
					<Text wrap="truncate-end" color={colors.text}>
						{args.query}
					</Text>
				</Box>

				{args.include && (
					<Box>
						<Text color={colors.secondary}>Include: </Text>
						<Text wrap="truncate-end" color={colors.text}>
							{args.include}
						</Text>
					</Box>
				)}

				{args.path && (
					<Box>
						<Text color={colors.secondary}>Path: </Text>
						<Text wrap="truncate-end" color={colors.text}>
							{args.path}
						</Text>
					</Box>
				)}

				{args.caseSensitive && (
					<Box>
						<Text color={colors.secondary}>Case sensitive: </Text>
						<Text color={colors.text}>yes</Text>
					</Box>
				)}

				{args.wholeWord && (
					<Box>
						<Text color={colors.secondary}>Whole word: </Text>
						<Text color={colors.text}>yes</Text>
					</Box>
				)}

				{args.contextLines !== undefined && args.contextLines > 0 && (
					<Box>
						<Text color={colors.secondary}>Context: </Text>
						<Text color={colors.text}>±{args.contextLines} lines</Text>
					</Box>
				)}

				<Box>
					<Text color={colors.secondary}>Matches: </Text>
					<Text color={colors.text}>{matchCount}</Text>
				</Box>

				{tokens > 0 && (
					<Box>
						<Text color={colors.secondary}>Tokens: </Text>
						<Text color={colors.text}>~{tokens.toLocaleString()}</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const searchFileContentsFormatter = (
	args: SearchFileContentsFormatterProps['args'],
	result?: string,
): React.ReactElement => {
	if (result && result.startsWith('Error:')) {
		return <></>;
	}
	return <SearchFileContentsFormatter args={args} result={result} />;
};

export const searchFileContentsTool: NanocoderToolExport = {
	name: 'search_file_contents' as const,
	tool: searchFileContentsCoreTool,
	formatter: searchFileContentsFormatter,
	readOnly: true,
};
