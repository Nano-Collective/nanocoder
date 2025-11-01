import {exec} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import React from 'react';
import ignore from 'ignore';

const execAsync = promisify(exec);
import {Text, Box} from 'ink';
import type {ToolDefinition} from '@/types/index';
import {tool, jsonSchema} from '@/types/core';
import {ThemeContext} from '@/hooks/useTheme';
import ToolMessage from '@/components/tool-message';

interface SearchMatch {
	file: string;
	line?: number;
	content?: string;
	context?: string[];
}

interface SearchResult {
	matches: SearchMatch[];
	truncated: boolean;
	totalMatches: number;
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
async function searchFiles(
	query: string,
	cwd: string,
	maxResults: number,
	_contextLines: number,
): Promise<SearchResult> {
	try {
		const ig = loadGitignore(cwd);

		// Use grep with basic exclusions for performance, then filter with gitignore
		// We still exclude the most common large directories to avoid performance issues
		const {stdout} = await execAsync(
			`grep -rn -i --include="*" --exclude-dir={node_modules,.git,dist,build,coverage,.next,.nuxt,out,.cache} "${query.replace(
				/"/g,
				'\\"',
			)}" . | head -n ${maxResults * 3}`,
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
			totalMatches: matches.length,
		};
	} catch (error: unknown) {
		// grep returns exit code 1 when no matches found
		if (error instanceof Error && 'code' in error && error.code === 1) {
			return {matches: [], truncated: false, totalMatches: 0};
		}
		throw error;
	}
}

/**
 * List files matching a glob pattern using find
 */
async function listFiles(
	pattern: string,
	cwd: string,
	maxResults: number,
): Promise<SearchResult> {
	try {
		const ig = loadGitignore(cwd);

		// Convert glob pattern to find-compatible pattern
		// **/*.ts -> -name "*.ts"
		// **/*.{ts,tsx} -> \( -name "*.ts" -o -name "*.tsx" \)
		let findPattern = '';

		if (pattern.includes('{') && pattern.includes('}')) {
			// Handle brace expansion
			const braceMatch = pattern.match(/\{([^}]+)\}/);
			if (braceMatch) {
				const extensions = braceMatch[1].split(',');
				const patterns = extensions.map(ext => `-name "*.${ext}"`).join(' -o ');
				findPattern = `\\( ${patterns} \\)`;
			}
		} else {
			// Simple pattern like **/*.ts
			const ext = pattern.split('*').pop();
			findPattern = `-name "*${ext}"`;
		}

		// Find files with basic exclusions for performance, filter afterward with gitignore
		const {stdout} = await execAsync(
			`find . -type f ${findPattern} -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/coverage/*" -not -path "*/.next/*" -not -path "*/.nuxt/*" -not -path "*/out/*" -not -path "*/.cache/*" | head -n ${
				maxResults * 3
			}`,
			{cwd, maxBuffer: 1024 * 1024},
		);

		const allFiles = stdout
			.trim()
			.split('\n')
			.filter(Boolean)
			.map(line => line.replace(/^\.\//, ''));

		// Filter using gitignore
		const matches: SearchMatch[] = [];
		for (const file of allFiles) {
			if (!ig.ignores(file)) {
				matches.push({file});

				// Stop once we have enough matches
				if (matches.length >= maxResults) {
					break;
				}
			}
		}

		return {
			matches,
			truncated:
				allFiles.length >= maxResults * 3 || matches.length >= maxResults,
			totalMatches: matches.length,
		};
	} catch (error: unknown) {
		if (error instanceof Error && 'code' in error && error.code === 1) {
			return {matches: [], truncated: false, totalMatches: 0};
		}
		throw error;
	}
}

interface SearchFilesArgs {
	query?: string;
	pattern?: string;
	maxResults?: number;
	contextLines?: number;
}

const executeSearchFiles = async (args: SearchFilesArgs): Promise<string> => {
	const cwd = process.cwd();
	const maxResults = args.maxResults || 50;
	const contextLines = args.contextLines || 2;

	try {
		let result: SearchResult;

		if (args.query) {
			// Content search
			result = await searchFiles(args.query, cwd, maxResults, contextLines);

			if (result.matches.length === 0) {
				return `No matches found for "${args.query}"`;
			}

			// Format results
			let output = `Found ${result.totalMatches} matches${
				result.truncated ? ` (showing first ${maxResults})` : ''
			}:\n\n`;

			for (const match of result.matches) {
				output += `${match.file}:${match.line}\n`;
				if (match.content) {
					output += `  ${match.content}\n`;
				}
				if (match.context && match.context.length > 1) {
					output += `  Context:\n`;
					for (const line of match.context.slice(0, 3)) {
						output += `    ${line.trim()}\n`;
					}
				}
				output += '\n';
			}

			return output.trim();
		} else if (args.pattern) {
			// File pattern search
			result = await listFiles(args.pattern, cwd, maxResults);

			if (result.matches.length === 0) {
				return `No files found matching pattern "${args.pattern}"`;
			}

			let output = `Found ${result.totalMatches} files${
				result.truncated ? ` (showing first ${maxResults})` : ''
			}:\n\n`;
			output += result.matches.map(m => m.file).join('\n');

			return output;
		} else {
			throw new Error('Either "query" or "pattern" must be provided');
		}
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		throw new Error(`Search failed: ${errorMessage}`);
	}
};

// AI SDK tool definition
const searchFilesCoreTool = tool({
	description:
		'Search for files by pattern or search file contents (ripgrep-based code search)',
	inputSchema: jsonSchema<SearchFilesArgs>({
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'Text to search for in file contents (case-insensitive).',
			},
			pattern: {
				type: 'string',
				description:
					'File path pattern to search for (e.g., "*.tsx", "components/**").',
			},
			maxResults: {
				type: 'number',
				description: 'Maximum number of results to return (default: 50).',
			},
			contextLines: {
				type: 'number',
				description:
					'Number of context lines to show around matches (default: 2).',
			},
		},
		required: [],
	}),
	// NO execute function - prevents AI SDK auto-execution
});

interface SearchFilesFormatterProps {
	args: {
		query?: string;
		pattern?: string;
		maxResults?: number;
	};
	result?: string;
}

const SearchFilesFormatter = React.memo(
	({args, result}: SearchFilesFormatterProps) => {
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
				<Text color={colors.tool}>⚒ search_files</Text>

				{args.query && (
					<Box>
						<Text color={colors.secondary}>Query: </Text>
						<Text color={colors.white}>{args.query}</Text>
					</Box>
				)}

				{args.pattern && (
					<Box>
						<Text color={colors.secondary}>Pattern: </Text>
						<Text color={colors.white}>{args.pattern}</Text>
					</Box>
				)}

				<Box>
					<Text color={colors.secondary}>Results: </Text>
					<Text color={colors.white}>{matchCount}</Text>
				</Box>
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const formatter = (
	args: SearchFilesFormatterProps['args'],
	result?: string,
): React.ReactElement => {
	if (result && result.startsWith('Error:')) {
		return <></>;
	}
	return <SearchFilesFormatter args={args} result={result} />;
};

// Nanocoder tool definition with AI SDK core tool + custom extensions
export const searchFilesTool: ToolDefinition = {
	name: 'search_files',
	tool: searchFilesCoreTool, // Native AI SDK tool (no execute)
	handler: executeSearchFiles,
	formatter,
	requiresConfirmation: false,
};

// Export the AI SDK core tool for Phase 3-4 migration
export {searchFilesCoreTool};
