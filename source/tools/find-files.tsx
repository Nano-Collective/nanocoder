import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {DEFAULT_FIND_FILES_RESULTS, MAX_FIND_FILES_RESULTS} from '@/constants';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {findMatchingPaths} from '@/utils/file-search';
import {calculateTokens} from '@/utils/token-calculator';

/**
 * Find files matching a glob pattern using a cross-platform Node.js traversal
 */
async function findFilesByPattern(
	pattern: string,
	cwd: string,
	maxResults: number,
): Promise<{files: string[]; truncated: boolean}> {
	return findMatchingPaths(pattern, cwd, maxResults);
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
		'Find files and directories by path pattern. Use this INSTEAD OF bash find/locate/ls commands for file discovery. Examples: "*.tsx" (all .tsx files), "src/**/*.ts" (recursive in src/), "*.{ts,tsx}" (multiple extensions), "package.json" (exact file), "*config*" (files containing "config"). Excludes node_modules, .git, dist, build automatically.',
	inputSchema: jsonSchema<FindFilesArgs>({
		type: 'object',
		properties: {
			pattern: {
				type: 'string',
				description:
					'Glob pattern to match file and directory paths. Examples: "*.tsx" (all .tsx files), "src/**/*.ts" (recursive in src/), "*.{ts,tsx}" (multiple extensions), "package.json" (exact file), "*config*" (files containing "config"), "source/tools/*.ts" (specific directory)',
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

		// Calculate tokens
		const tokens = result ? calculateTokens(result) : 0;

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ find_files</Text>

				<Box>
					<Text color={colors.secondary}>Pattern: </Text>
					<Text wrap="truncate-end" color={colors.text}>
						{args.pattern}
					</Text>
				</Box>

				<Box>
					<Text color={colors.secondary}>Results: </Text>
					<Text color={colors.text}>{fileCount}</Text>
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

const findFilesFormatter = (
	args: FindFilesFormatterProps['args'],
	result?: string,
): React.ReactElement => {
	if (result && result.startsWith('Error:')) {
		return <></>;
	}
	return <FindFilesFormatter args={args} result={result} />;
};

export const findFilesTool: NanocoderToolExport = {
	name: 'find_files' as const,
	tool: findFilesCoreTool,
	formatter: findFilesFormatter,
	readOnly: true,
};
