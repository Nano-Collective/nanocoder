import {resolve, dirname} from 'node:path';
import {writeFile, access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {highlight} from 'cli-highlight';
import React from 'react';
import {Text, Box} from 'ink';
import type {ToolDefinition} from '@/types/index';
import {tool, jsonSchema} from '@/types/core';
import {ThemeContext} from '@/hooks/useTheme';
import {getLanguageFromExtension} from '@/utils/programming-language-helper';
import ToolMessage from '@/components/tool-message';

// Handler function - used by both Nanocoder and AI SDK tool
const executeCreateFile = async (args: {
	path: string;
	content: string;
}): Promise<string> => {
	const absPath = resolve(args.path);
	await writeFile(absPath, args.content, 'utf-8');
	return 'File written successfully';
};

// AI SDK tool definition
const createFileCoreTool = tool({
	description:
		'Create a new file with the specified content (overwrites if file exists)',
	inputSchema: jsonSchema<{path: string; content: string}>({
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
	}),
	// NO execute function - prevents AI SDK auto-execution
});

interface CreateFileArgs {
	path?: string;
	file_path?: string;
	content?: string;
}

// Create a component that will re-render when theme changes
const CreateFileFormatter = React.memo(({args}: {args: CreateFileArgs}) => {
	const themeContext = React.useContext(ThemeContext);
	if (!themeContext) {
		throw new Error('ThemeContext is required');
	}
	const {colors} = themeContext;
	const path = args.path || args.file_path || 'unknown';
	const newContent = args.content || '';
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
						const ext = path.split('.').pop()?.toLowerCase() ?? '';
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

const formatter = (args: CreateFileArgs): React.ReactElement => {
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
	} catch (error) {
		// ENOENT is good - file doesn't exist
		if (error && typeof error === 'object' && 'code' in error) {
			if (error.code !== 'ENOENT') {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error';
				return {
					valid: false,
					error: `⚒ Cannot access path "${args.path}": ${errorMessage}`,
				};
			}
		}
	}

	// Check if parent directory exists
	const parentDir = dirname(absPath);
	try {
		await access(parentDir, constants.F_OK);
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error) {
			if (error.code === 'ENOENT') {
				return {
					valid: false,
					error: `⚒ Parent directory does not exist: "${parentDir}"`,
				};
			}
		}
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		return {
			valid: false,
			error: `⚒ Cannot access parent directory "${parentDir}": ${errorMessage}`,
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

// Nanocoder tool definition with AI SDK core tool + custom extensions
export const createFileTool: ToolDefinition = {
	name: 'create_file',
	tool: createFileCoreTool, // Native AI SDK tool (no execute)
	handler: executeCreateFile, // Manual execution after confirmation
	formatter,
	validator,
};

// Export the AI SDK core tool for Phase 3-4 migration
export {createFileCoreTool};
