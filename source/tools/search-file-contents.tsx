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
): Promise<{matches: SearchMatch[]; truncated: boolean}> {
	try {
		const ig = loadGitignore(cwd);

		// Build grep arguments array to prevent command injection
		const grepArgs: string[] = [
			'-rn', // recursive with line numbers
			'-E', // extended regex
		];

		// Add case sensitivity flag
		if (!caseSensitive) {
			grepArgs.push('-i');
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

		// Execute grep command with array-based arguments
		const {stdout} = await execFileAsync('grep', grepArgs, {
			cwd,
			maxBuffer: BUFFER_FIND_FILES_BYTES * BUFFER_GREP_MULTIPLIER,
		});

		const matches: SearchMatch[] = [];
		const lines = stdout.trim().split('\n').filter(Boolean);
		const cwdPrefix = path.resolve(cwd) + path.sep;

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

		return {
			matches,
			truncated: lines.length >= maxResults || matches.length >= maxResults,
		};
	} catch (error: unknown) {
		// grep returns exit code 1 when no matches found
		if (error instanceof Error && 'code' in error && error.code === 1) {
			return {matches: [], truncated: false};
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
}

const executeSearchFileContents = async (
	args: SearchFileContentsArgs,
): Promise<string> => {
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
		'Search for text or code inside files. AUTO-ACCEPTED (no user approval needed). Use this INSTEAD OF bash grep/rg/ag/ack commands. Supports extended regex (e.g., "foo|bar", "func(tion)?"). Returns file:line with matching content. Use to find: function definitions, variable usage, import statements, TODO comments. Case-insensitive by default (use caseSensitive=true for exact matching). Use include to filter by file type (e.g., "*.ts") and path to scope to a directory (e.g., "src/components").',
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
					<Text color={colors.text}>{args.query}</Text>
				</Box>

				{args.include && (
					<Box>
						<Text color={colors.secondary}>Include: </Text>
						<Text color={colors.text}>{args.include}</Text>
					</Box>
				)}

				{args.path && (
					<Box>
						<Text color={colors.secondary}>Path: </Text>
						<Text color={colors.text}>{args.path}</Text>
					</Box>
				)}

				{args.caseSensitive && (
					<Box>
						<Text color={colors.secondary}>Case sensitive: </Text>
						<Text color={colors.text}>yes</Text>
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
};
