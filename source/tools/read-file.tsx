import {resolve} from 'node:path';
import {readFile, access} from 'node:fs/promises';
import {constants} from 'node:fs';
import React from 'react';
import {Text, Box} from 'ink';
import type {ToolHandler, ToolDefinition} from '@/types/index';
import {ThemeContext} from '@/hooks/useTheme';
import ToolMessage from '@/components/tool-message';
import {fileReadTracker} from '@/utils/file-read-tracker';

const handler: ToolHandler = async (args: {path: string}): Promise<string> => {
	const absPath = resolve(args.path);

	try {
		const content = await readFile(absPath, 'utf-8');

		// Check if file is empty (0 tokens)
		if (content.length === 0) {
			throw new Error(`File "${args.path}" exists but is empty (0 tokens)`);
		}

		const lines = content.split('\n');

		// Return content with line numbers for precise editing
		let result = '';
		for (let i = 0; i < lines.length; i++) {
			const lineNum = String(i + 1).padStart(4, ' ');
			result += `${lineNum}: ${lines[i]}\n`;
		}

		// Mark this file as read (track it for edit validation)
		fileReadTracker.markAsRead(args.path);

		return result.slice(0, -1); // Remove trailing newline
	} catch (error: unknown) {
		// Handle file not found and other filesystem errors
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			throw new Error(`File "${args.path}" does not exist`);
		}

		// Re-throw other errors (including our empty file error)
		throw error;
	}
};

// Create a component that will re-render when theme changes
const ReadFileFormatter = React.memo(
	({
		args,
		fileInfo,
	}: {
		args: {path?: string; file_path?: string; offset?: number; limit?: number};
		fileInfo: {size: number; tokens: number};
	}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ReadFileFormatter must be used within a ThemeProvider');
		}
		const {colors} = themeContext;
		const path = args.path || args.file_path || 'unknown';

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ read_file</Text>

				<Box>
					<Text color={colors.secondary}>Path: </Text>
					<Text color={colors.white}>{path}</Text>
				</Box>

				<Box>
					<Text color={colors.secondary}>Size: </Text>
					<Text color={colors.white}>
						{fileInfo.size} characters (~{fileInfo.tokens} tokens)
					</Text>
				</Box>

				{(args.offset || args.limit) && (
					<Box marginTop={1}>
						<Text color={colors.secondary}>Range: </Text>
						<Text color={colors.primary}>
							{args.offset && `from line ${args.offset} `}
							{args.limit && `(${args.limit} lines)`}
						</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const formatter = async (
	args: {path?: string; file_path?: string; offset?: number; limit?: number},
	result?: string,
): Promise<React.ReactElement> => {
	// If result is an error message, don't try to read the file
	if (result && result.startsWith('Error:')) {
		return <></>;
	}

	// Load file info synchronously in the formatter so it's available when the component renders
	let fileInfo = {size: 0, tokens: 0};
	try {
		const path = args.path || args.file_path;
		if (path && typeof path === 'string') {
			await access(resolve(path), constants.F_OK);
			const content = await readFile(resolve(path), 'utf-8');
			const fileSize = content.length;
			const estimatedTokens = Math.ceil(fileSize / 4);
			fileInfo = {size: fileSize, tokens: estimatedTokens};
		}
	} catch {
		// File doesn't exist or can't be read - keep fileInfo as {size: 0, tokens: 0}
	}

	return <ReadFileFormatter args={args} fileInfo={fileInfo} />;
};

const validator = async (args: {
	path: string;
}): Promise<{valid: true} | {valid: false; error: string}> => {
	const absPath = resolve(args.path);

	try {
		await access(absPath, constants.F_OK);
		return {valid: true};
	} catch (error: unknown) {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			return {
				valid: false,
				error: `⚒ File "${args.path}" does not exist`,
			};
		}
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		return {
			valid: false,
			error: `⚒ Cannot access file "${args.path}": ${errorMessage}`,
		};
	}
};

export const readFileTool: ToolDefinition = {
	handler,
	formatter,
	validator,
	requiresConfirmation: false,
	config: {
		type: 'function',
		function: {
			name: 'read_file',
			description:
				'Read the contents of a file with line numbers (use line numbers with edit_file tool for precise editing)',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'The path to the file to read.',
					},
				},
				required: ['path'],
			},
		},
	},
};
