import {execFile} from 'node:child_process';
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
import {jsonSchema, tool} from '@/types/core';
import {loadGitignore} from '@/utils/gitignore-loader';

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

		// Add include and exclude patterns
		grepArgs.push('--include=*');
		grepArgs.push(
			'--exclude-dir=node_modules',
			'--exclude-dir=.git',
			'--exclude-dir=dist',
			'--exclude-dir=build',
			'--exclude-dir=coverage',
			'--exclude-dir=.next',
			'--exclude-dir=.nuxt',
			'--exclude-dir=out',
			'--exclude-dir=.cache',
		);

		// Add the search query (no escaping needed with array-based args)
		grepArgs.push(query);

		// Add search path
		grepArgs.push('.');

		// Execute grep command with array-based arguments
		const {stdout} = await execFileAsync('grep', grepArgs, {
			cwd,
			maxBuffer: BUFFER_FIND_FILES_BYTES * BUFFER_GREP_MULTIPLIER,
		});

		const matches: SearchMatch[] = [];
		const lines = stdout.trim().split('\n').filter(Boolean);

		for (const line of lines) {
			const match = line.match(/^\.\/(.+?):(\d+):(.*)$/);
			if (match) {
				const filePath = match[1];

				// Skip files ignored by gitignore
				if (ig.ignores(filePath)) {
					continue;
				}

				matches.push({
					file: filePath,
					line: parseInt(match[2], 10),
					content: match[3].trim(),
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

	try {
		const {matches, truncated} = await searchFileContents(
			args.query,
			cwd,
			maxResults,
			caseSensitive,
		);

		if (matches.length === 0) {
			return `No matches found for "${args.query}"`;
		}

		// Format results with clear file:line format
		let output = `Found ${matches.length} match${
			matches.length === 1 ? '' : 'es'
		}${truncated ? ` (showing first ${maxResults})` : ''}:\n\n`;

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
		'Search for text or code inside files. AUTO-ACCEPTED (no user approval needed). Use this INSTEAD OF bash grep/rg commands. Supports regex patterns. Returns file:line with context. Use this to find where specific code, functions, variables, or text appears in the codebase.',
	inputSchema: jsonSchema<SearchFileContentsArgs>({
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description:
					'Text or code to search for inside files. Supports extended regex (e.g., "foo|bar" for alternation, "func(tion)?" for optional groups). Examples: "handleSubmit", "import React", "TODO|FIXME", "class\\s+\\w+". Search is case-insensitive by default.',
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

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ search_file_contents</Text>

				<Box>
					<Text color={colors.secondary}>Query: </Text>
					<Text color={colors.white}>{args.query}</Text>
				</Box>

				{args.caseSensitive && (
					<Box>
						<Text color={colors.secondary}>Case sensitive: </Text>
						<Text color={colors.white}>yes</Text>
					</Box>
				)}

				<Box>
					<Text color={colors.secondary}>Matches: </Text>
					<Text color={colors.white}>{matchCount}</Text>
				</Box>
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

export const searchFileContentsTool = {
	name: 'search_file_contents' as const,
	tool: searchFileContentsCoreTool,
	formatter: searchFileContentsFormatter,
};
