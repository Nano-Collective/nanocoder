import path from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS} from '@/constants';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {searchProjectContents} from '@/utils/file-search';
import {isValidFilePath} from '@/utils/path-validation';
import {calculateTokens} from '@/utils/token-calculator';

const MAX_CONTEXT_LINES = 10;

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
		const {matches, truncated} = await searchProjectContents(
			args.query,
			cwd,
			maxResults,
			caseSensitive,
			args.include,
			searchPath,
			args.wholeWord,
			Math.min(args.contextLines ?? 0, MAX_CONTEXT_LINES),
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
