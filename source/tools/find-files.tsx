import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {
	BUFFER_FIND_FILES_BYTES,
	DEFAULT_FIND_FILES_RESULTS,
	MAX_FIND_FILES_RESULTS,
} from '@/constants';
import {ThemeContext} from '@/hooks/useTheme';
import {jsonSchema, tool} from '@/types/core';
import {loadGitignore} from '@/utils/gitignore-loader';

const execFileAsync = promisify(execFile);

/**
 * Find files matching a glob pattern using find command
 */
async function findFilesByPattern(
	pattern: string,
	cwd: string,
	maxResults: number,
): Promise<{files: string[]; truncated: boolean}> {
	try {
		const ig = loadGitignore(cwd);

		// Build find arguments array to prevent command injection
		const findArgs: string[] = ['.'];

		if (pattern.includes('{') && pattern.includes('}')) {
			// Handle brace expansion like *.{ts,tsx}
			const braceMatch = pattern.match(/\{([^}]+)\}/);
			if (braceMatch) {
				const extensions = braceMatch[1].split(',');
				// Build: ( -name "*.ext1" -o -name "*.ext2" )
				findArgs.push('(');
				for (let i = 0; i < extensions.length; i++) {
					if (i > 0) {
						findArgs.push('-o');
					}
					findArgs.push('-name', `*.${extensions[i].trim()}`);
				}
				findArgs.push(')');
			}
		} else if (pattern.startsWith('**/')) {
			// Pattern like **/*.ts - search everywhere
			const namePattern = pattern.replace('**/', '');
			findArgs.push('-name', namePattern);
		} else if (pattern.includes('/**')) {
			// Pattern like scripts/** or scripts/**/*.ts - search within a directory
			const parts = pattern.split('/**');
			const pathPrefix = `./${parts[0]}`;
			const namePattern = parts[1] ? parts[1].replace(/^\//, '') : '*';

			// Replace the starting '.' with pathPrefix
			findArgs[0] = pathPrefix;

			if (namePattern !== '*' && namePattern !== '') {
				findArgs.push('-name', namePattern);
			}
		} else if (pattern.includes('/') && pattern.includes('*')) {
			// Pattern like source/tools/*.ts - has both path and wildcard
			// Split into directory path and filename pattern
			const lastSlashIndex = pattern.lastIndexOf('/');
			const dirPath = pattern.substring(0, lastSlashIndex);
			const filePattern = pattern.substring(lastSlashIndex + 1);

			// Start search from the directory
			findArgs[0] = `./${dirPath}`;
			// Only descend one level (maxdepth 1) to match the specific directory
			findArgs.push('-maxdepth', '1', '-name', filePattern);
		} else if (pattern.includes('*')) {
			// Simple pattern like *.ts
			findArgs.push('-name', pattern);
		} else {
			// Exact path or directory name
			findArgs.push('-name', pattern);
		}

		// Add exclusions
		const exclusions = [
			'*/node_modules/*',
			'*/.git/*',
			'*/dist/*',
			'*/build/*',
			'*/coverage/*',
			'*/.next/*',
			'*/.nuxt/*',
			'*/out/*',
			'*/.cache/*',
		];

		for (const exclusion of exclusions) {
			findArgs.push('-not', '-path', exclusion);
		}

		// Execute find command with array-based arguments
		const {stdout} = await execFileAsync('find', findArgs, {
			cwd,
			maxBuffer: BUFFER_FIND_FILES_BYTES,
		});

		const allPaths = stdout
			.trim()
			.split('\n')
			.filter(Boolean)
			.map(line => line.replace(/^\.\//, ''))
			.filter(path => path && path !== '.');

		// Filter using gitignore and limit results
		const paths: string[] = [];
		for (const path of allPaths) {
			if (!ig.ignores(path)) {
				paths.push(path);

				if (paths.length >= maxResults) {
					break;
				}
			}
		}

		return {
			files: paths,
			truncated: allPaths.length >= maxResults || paths.length >= maxResults,
		};
	} catch (error: unknown) {
		if (error instanceof Error && 'code' in error && error.code === 1) {
			return {files: [], truncated: false};
		}
		throw error;
	}
}

interface FindFilesArgs {
	pattern: string;
	maxResults?: number;
}

const executeFindFiles = async (args: FindFilesArgs): Promise<string> => {
	const cwd = process.cwd();
	const maxResults = Math.min(
		args.maxResults || DEFAULT_FIND_FILES_RESULTS,
		MAX_FIND_FILES_RESULTS,
	);

	try {
		const {files, truncated} = await findFilesByPattern(
			args.pattern,
			cwd,
			maxResults,
		);

		if (files.length === 0) {
			return `No files or directories found matching pattern "${args.pattern}"`;
		}

		let output = `Found ${files.length} match${files.length === 1 ? '' : 'es'}${
			truncated ? ` (showing first ${maxResults})` : ''
		}:\n\n`;
		output += files.join('\n');

		return output;
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		throw new Error(`File search failed: ${errorMessage}`);
	}
};

const findFilesCoreTool = tool({
	description:
		'Find files and directories by path pattern. AUTO-ACCEPTED (no user approval needed). Use this INSTEAD OF bash find/locate commands. Examples: "*.tsx" (all .tsx files), "src/**/*.ts" (recursive), "config*" (partial match). Returns a list of matching file and directory paths. Does NOT search file contents - use search_file_contents for that.',
	inputSchema: jsonSchema<FindFilesArgs>({
		type: 'object',
		properties: {
			pattern: {
				type: 'string',
				description:
					'Glob pattern to match file and directory paths. Examples: "*.tsx" (all .tsx files), "src/**/*.ts" (all .ts in src/), "components/**" (all files/dirs in components/), "*.{ts,tsx}" (multiple extensions)',
			},
			maxResults: {
				type: 'number',
				description:
					'Maximum number of results to return (default: 50, max: 100)',
			},
		},
		required: ['pattern'],
	}),
	// Low risk: read-only operation, never requires approval
	needsApproval: false,
	execute: async (args, _options) => {
		return await executeFindFiles(args);
	},
});

interface FindFilesFormatterProps {
	args: {
		pattern: string;
		maxResults?: number;
	};
	result?: string;
}

const FindFilesFormatter = React.memo(
	({args, result}: FindFilesFormatterProps) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext not found');
		}
		const {colors} = themeContext;

		// Parse result to get file count
		let fileCount = 0;
		if (result && !result.startsWith('Error:')) {
			const firstLine = result.split('\n')[0];
			const matchFound = firstLine.match(/Found (\d+)/);
			if (matchFound) {
				fileCount = parseInt(matchFound[1], 10);
			}
		}

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ find_files</Text>

				<Box>
					<Text color={colors.secondary}>Pattern: </Text>
					<Text color={colors.white}>{args.pattern}</Text>
				</Box>

				<Box>
					<Text color={colors.secondary}>Results: </Text>
					<Text color={colors.white}>{fileCount}</Text>
				</Box>
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const findFilesFormatter = (
	args: FindFilesFormatterProps['args'],
	result?: string,
): React.ReactElement => {
	if (result && result.startsWith('Error:')) {
		return <></>;
	}
	return <FindFilesFormatter args={args} result={result} />;
};

export const findFilesTool = {
	name: 'find_files' as const,
	tool: findFilesCoreTool,
	formatter: findFilesFormatter,
};
