import {exec} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import React from 'react';
import ignore from 'ignore';
import {Text, Box} from 'ink';

import {tool, jsonSchema} from '@/types/core';
import {ThemeContext} from '@/hooks/useTheme';
import ToolMessage from '@/components/tool-message';

const execAsync = promisify(exec);

interface SearchMatch {
	file: string;
	line: number;
	content: string;
}

/**
 * Load and parse .gitignore file, returns an ignore instance
 */
function loadGitignore(cwd: string): ReturnType<typeof ignore> {
	const ig = ignore();
	const gitignorePath = join(cwd, '.gitignore');

	// Always ignore common directories
	ig.add([
		'node_modules',
		'.git',
		'dist',
		'build',
		'coverage',
		'.next',
		'.nuxt',
		'out',
		'.cache',
	]);

	// Load .gitignore if it exists
	if (existsSync(gitignorePath)) {
		try {
			const gitignoreContent = readFileSync(gitignorePath, 'utf-8');
			ig.add(gitignoreContent);
		} catch {
			// Silently fail if we can't read .gitignore
			// The hardcoded ignores above will still apply
		}
	}

	return ig;
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

		// Escape query for shell safety
		const escapedQuery = query.replace(/"/g, '\\"');

		// Use grep with basic exclusions for performance
		const caseFlag = caseSensitive ? '' : '-i';
		const {stdout} = await execAsync(
			`grep -rn ${caseFlag} --include="*" --exclude-dir={node_modules,.git,dist,build,coverage,.next,.nuxt,out,.cache} "${escapedQuery}" . | head -n ${
				maxResults * 3
			}`,
			{cwd, maxBuffer: 1024 * 1024},
		);

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
			truncated: lines.length >= maxResults * 3 || matches.length >= maxResults,
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
	const maxResults = Math.min(args.maxResults || 30, 100);
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
		'Search for text or code INSIDE file contents. Returns file paths with line numbers and matching content. Use this to find where specific code, functions, variables, or text appears in the codebase.',
	inputSchema: jsonSchema<SearchFileContentsArgs>({
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description:
					'Text or code to search for inside files. Examples: "handleSubmit", "import React", "TODO", "function calculateTotal". Search is case-insensitive by default.',
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
