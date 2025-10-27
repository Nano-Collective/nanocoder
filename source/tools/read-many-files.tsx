import {resolve} from 'node:path';
import {readFile, access} from 'node:fs/promises';
import {constants} from 'node:fs';
import React from 'react';
import {Text, Box} from 'ink';
import type {ToolHandler, ToolDefinition} from '@/types/index';
import {ThemeContext} from '@/hooks/useTheme';
import ToolMessage from '@/components/tool-message';
import {fileReadTracker} from '@/utils/file-read-tracker';

const handler: ToolHandler = async (args: {
	paths: string[];
}): Promise<string> => {
	if (!Array.isArray(args.paths)) {
		throw new Error('paths must be an array of strings');
	}
	const results = [] as {
		path: string;
		content: string;
		size: number;
		estimatedTokens: number;
	}[];
	let totalSize = 0;
	let totalEstimatedTokens = 0;

	for (const p of args.paths) {
		try {
			const content = await readFile(resolve(p), 'utf-8');
			const lines = content.split('\n');

			// Add line numbers for precise editing
			let numberedContent = '';
			for (let i = 0; i < lines.length; i++) {
				const lineNum = String(i + 1).padStart(4, ' ');
				numberedContent += `${lineNum}: ${lines[i]}\n`;
			}

			const fileSize = content.length;
			const estimatedTokens = Math.ceil(fileSize / 4);
			totalSize += fileSize;
			totalEstimatedTokens += estimatedTokens;

			// Mark this file as read (track it for edit validation)
			fileReadTracker.markAsRead(p);

			results.push({
				path: p,
				content: numberedContent.slice(0, -1),
				size: fileSize,
				estimatedTokens,
			});
		} catch (err) {
			results.push({
				path: p,
				content: `Error reading file: ${
					err instanceof Error ? err.message : String(err)
				}`,
				size: 0,
				estimatedTokens: 0,
			});
		}
	}

	// Include summary in the output
	const summary = {
		totalFiles: args.paths.length,
		totalSize,
		totalEstimatedTokens,
		files: results,
	};

	return JSON.stringify(summary);
};

// Create a component that will re-render when theme changes
const ReadManyFilesFormatter = React.memo(
	({
		args,
		fileInfo,
	}: {
		args: {paths?: unknown};
		fileInfo: {totalFiles: number; totalSize: number; totalTokens: number};
	}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error(
				'ReadManyFilesFormatter must be used within a ThemeProvider',
			);
		}
		const {colors} = themeContext;
		const paths = args.paths || [];

		if (!Array.isArray(paths)) {
			const messageContent = (
				<Box flexDirection="column">
					<Text color={colors.tool}>⚒ read_many_files</Text>
					<Text color={colors.error}>Error: paths must be an array</Text>
				</Box>
			);
			return <ToolMessage message={messageContent} hideBox={true} />;
		}

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ read_many_files</Text>

				<Box>
					<Text color={colors.secondary}>Files: </Text>
					<Text color={colors.white}>{fileInfo.totalFiles}</Text>
				</Box>

				<Box>
					<Text color={colors.secondary}>Total size: </Text>
					<Text color={colors.white}>
						{fileInfo.totalSize} characters (~{fileInfo.totalTokens} tokens)
					</Text>
				</Box>

				<Box marginTop={1} flexDirection="column">
					<Text color={colors.white}>Paths:</Text>
					{paths.map((path: string, i: number) => (
						<Box key={i} marginLeft={2}>
							<Text color={colors.secondary}>• </Text>
							<Text color={colors.primary}>{path}</Text>
						</Box>
					))}
				</Box>
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const formatter = async (
	args: {paths?: unknown},
	result?: string,
): Promise<React.ReactElement> => {
	// If result is an error message, don't try to read the files
	if (result && result.startsWith('Error:')) {
		return <></>;
	}

	// Calculate file info synchronously in the formatter so it's available when the component renders
	let fileInfo = {
		totalFiles: 0,
		totalSize: 0,
		totalTokens: 0,
	};

	const paths = args.paths || [];
	if (Array.isArray(paths)) {
		let totalSize = 0;
		for (const path of paths) {
			if (typeof path === 'string') {
				try {
					const content = await readFile(resolve(path), 'utf-8');
					totalSize += content.length;
				} catch {
					// Skip files that can't be read
				}
			}
		}
		const estimatedTokens = Math.ceil(totalSize / 4);
		fileInfo = {
			totalFiles: paths.length,
			totalSize,
			totalTokens: estimatedTokens,
		};
	}

	return <ReadManyFilesFormatter args={args} fileInfo={fileInfo} />;
};

const validator = async (args: {
	paths: string[];
}): Promise<{valid: true} | {valid: false; error: string}> => {
	if (!Array.isArray(args.paths)) {
		return {
			valid: false,
			error: '⚒ Paths must be an array of strings',
		};
	}

	const missingFiles: string[] = [];

	for (const path of args.paths) {
		const absPath = resolve(path);
		try {
			await access(absPath, constants.F_OK);
		} catch (error: unknown) {
			if (
				error &&
				typeof error === 'object' &&
				'code' in error &&
				error.code === 'ENOENT'
			) {
				missingFiles.push(path);
			} else {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error';
				return {
					valid: false,
					error: `⚒ Cannot access file "${path}": ${errorMessage}`,
				};
			}
		}
	}

	if (missingFiles.length > 0) {
		const fileList = missingFiles.map(f => `  • ${f}`).join('\n');
		return {
			valid: false,
			error: `⚒ The following file${missingFiles.length > 1 ? 's' : ''} do${
				missingFiles.length > 1 ? '' : 'es'
			} not exist:\n${fileList}`,
		};
	}

	return {valid: true};
};

export const readManyFilesTool: ToolDefinition = {
	handler,
	formatter,
	validator,
	config: {
		type: 'function',
		function: {
			name: 'read_many_files',
			description:
				'Read the contents of multiple files with line numbers. Returns a JSON array of { path, content } in the same order as provided.',
			parameters: {
				type: 'object',
				properties: {
					paths: {
						type: 'array',
						items: {type: 'string'},
						description: 'Array of file paths to read, in order.',
					},
				},
				required: ['paths'],
			},
		},
	},
};
