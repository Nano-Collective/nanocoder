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
 * Find files matching a glob pattern using find command
 */
async function findFilesByPattern(
	pattern: string,
	cwd: string,
	maxResults: number,
): Promise<{files: string[]; truncated: boolean}> {
	try {
		const ig = loadGitignore(cwd);

		// Convert glob patterns to find-compatible patterns
		let findCommand = '';
		let pathPrefix = '.';

		if (pattern.includes('{') && pattern.includes('}')) {
			// Handle brace expansion like *.{ts,tsx}
			const braceMatch = pattern.match(/\{([^}]+)\}/);
			if (braceMatch) {
				const extensions = braceMatch[1].split(',');
				const patterns = extensions
					.map(ext => `-name "*.${ext.trim()}"`)
					.join(' -o ');
				findCommand = `find . \\( ${patterns} \\)`;
			}
		} else if (pattern.startsWith('**/')) {
			// Pattern like **/*.ts - search everywhere
			const namePattern = pattern.replace('**/', '');
			findCommand = `find . -name "${namePattern}"`;
		} else if (pattern.includes('/**')) {
			// Pattern like scripts/** or scripts/**/*.ts - search within a directory
			const parts = pattern.split('/**');
			pathPrefix = `./${parts[0]}`;
			const namePattern = parts[1] ? parts[1].replace(/^\//, '') : '*';

			if (namePattern === '*' || namePattern === '') {
				// Just list everything in the directory
				findCommand = `find ${pathPrefix}`;
			} else {
				findCommand = `find ${pathPrefix} -name "${namePattern}"`;
			}
		} else if (pattern.includes('*')) {
			// Simple pattern like *.ts
			findCommand = `find . -name "${pattern}"`;
		} else {
			// Exact path or directory name
			findCommand = `find . -name "${pattern}"`;
		}

		// Add exclusions and execute
		const {stdout} = await execAsync(
			`${findCommand} -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/coverage/*" -not -path "*/.next/*" -not -path "*/.nuxt/*" -not -path "*/out/*" -not -path "*/.cache/*" | head -n ${
				maxResults * 3
			}`,
			{cwd, maxBuffer: 1024 * 1024},
		);

		const allPaths = stdout
			.trim()
			.split('\n')
			.filter(Boolean)
			.map(line => line.replace(/^\.\//, ''))
			.filter(path => path && path !== '.');

		// Filter using gitignore
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
			truncated:
				allPaths.length >= maxResults * 3 || paths.length >= maxResults,
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
	const maxResults = Math.min(args.maxResults || 50, 100);

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
		'Find files and directories by path pattern or name. Use glob patterns like "*.tsx", "**/*.ts", "src/**/*.js", or "*.{ts,tsx}". Returns a list of matching file and directory paths. Does NOT search file contents - use search_file_contents for that.',
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
