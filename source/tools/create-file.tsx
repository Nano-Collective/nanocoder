import {resolve, dirname} from 'node:path';
import {writeFile, access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {highlight} from 'cli-highlight';
import React from 'react';
import {Text, Box} from 'ink';
import type {ToolHandler, ToolDefinition} from '@/types/index';
import {ThemeContext} from '@/hooks/useTheme';
import {getLanguageFromExtension} from '@/utils/programming-language-helper';
import ToolMessage from '@/components/tool-message';

const handler: ToolHandler = async (args: {
	path: string;
	content: string;
}): Promise<string> => {
	const absPath = resolve(args.path);
	await writeFile(absPath, args.content, 'utf-8');
	return 'File written successfully';
};

// Create a component that will re-render when theme changes
const CreateFileFormatter = React.memo(({args}: {args: any}) => {
	const {colors} = React.useContext(ThemeContext)!;
	const path = args.path || args.file_path || 'unknown';
	const newContent = typeof args.content === 'string' ? args.content : '';
	const lineCount = newContent.split('\n').length;
	const charCount = newContent.length;

	// Estimate tokens (rough approximation: ~4 characters per token)
	const estimatedTokens = Math.ceil(charCount / 4);

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>⚒ create_file</Text>

			<Box>
				<Text color={colors.secondary}>Path: </Text>
				<Text color={colors.white}>{path}</Text>
			</Box>
			<Box>
				<Text color={colors.secondary}>Size: </Text>
				<Text color={colors.white}>
					{lineCount} lines, {charCount} characters (~{estimatedTokens} tokens)
				</Text>
			</Box>

			{newContent.length > 0 ? (
				<Box flexDirection="column" marginTop={1}>
					<Text color={colors.white}>File content:</Text>
					{newContent.split('\n').map((line: string, i: number) => {
						const lineNumStr = String(i + 1).padStart(4, ' ');
						const ext = path.split('.').pop()?.toLowerCase();
						const language = getLanguageFromExtension(ext);

						try {
							const highlighted = highlight(line, {language, theme: 'default'});
							return (
								<Box key={i}>
									<Text color={colors.secondary}>{lineNumStr} </Text>
									<Text wrap="wrap">{highlighted}</Text>
								</Box>
							);
						} catch {
							return (
								<Box key={i}>
									<Text color={colors.secondary}>{lineNumStr} </Text>
									<Text wrap="wrap">{line}</Text>
								</Box>
							);
						}
					})}
				</Box>
			) : (
				<Box marginTop={1}>
					<Text color={colors.secondary}>File will be empty</Text>
				</Box>
			)}
		</Box>
	);

	return <ToolMessage message={messageContent} hideBox={true} />;
});

const formatter = async (args: any): Promise<React.ReactElement> => {
	return <CreateFileFormatter args={args} />;
};

const validator = async (args: {
	path: string;
	content: string;
}): Promise<{valid: true} | {valid: false; error: string}> => {
	const absPath = resolve(args.path);

	// Check if file already exists
	try {
		await access(absPath, constants.F_OK);
		return {
			valid: false,
			error: `⚒ File "${args.path}" already exists. Use a file editing tool instead.`,
		};
	} catch (error: any) {
		// ENOENT is good - file doesn't exist
		if (error.code !== 'ENOENT') {
			return {
				valid: false,
				error: `⚒ Cannot access path "${args.path}": ${error.message}`,
			};
		}
	}

	// Check if parent directory exists
	const parentDir = dirname(absPath);
	try {
		await access(parentDir, constants.F_OK);
	} catch (error: any) {
		if (error.code === 'ENOENT') {
			return {
				valid: false,
				error: `⚒ Parent directory does not exist: "${parentDir}"`,
			};
		}
		return {
			valid: false,
			error: `⚒ Cannot access parent directory "${parentDir}": ${error.message}`,
		};
	}

	// Check for invalid path characters or attempts to write to system directories
	const invalidPatterns = [
		/^\/etc\//i,
		/^\/sys\//i,
		/^\/proc\//i,
		/^\/dev\//i,
		/^\/boot\//i,
		/^C:\\Windows\\/i,
		/^C:\\Program Files\\/i,
	];

	for (const pattern of invalidPatterns) {
		if (pattern.test(absPath)) {
			return {
				valid: false,
				error: `⚒ Cannot create files in system directory: "${args.path}"`,
			};
		}
	}

	return {valid: true};
};

export const createFileTool: ToolDefinition = {
	handler,
	formatter,
	validator,
	config: {
		type: 'function',
		function: {
			name: 'create_file',
			description:
				'Create a new file with the specified content (overwrites if file exists)',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'The path to the file to write.',
					},
					content: {
						type: 'string',
						description: 'The content to write to the file.',
					},
				},
				required: ['path', 'content'],
			},
		},
	},
};
