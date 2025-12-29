import {spawn} from 'node:child_process';
import {highlight} from 'cli-highlight';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {TRUNCATION_OUTPUT_LIMIT} from '@/constants';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';

/**
 * Map of bash exploration commands to their native tool alternatives
 * These are commands that could be replaced with auto-accepted native tools
 */
const TOOL_ALTERNATIVES: Record<string, string> = {
	find: 'Consider using find_files tool instead (auto-accepted, no approval needed)',
	locate:
		'Consider using find_files tool instead (auto-accepted, no approval needed)',
	grep: 'Consider using search_file_contents tool instead (auto-accepted, no approval needed)',
	'grep -r':
		'Consider using search_file_contents tool instead (auto-accepted, no approval needed)',
	rg: 'Consider using search_file_contents tool instead (auto-accepted, no approval needed)',
	cat: 'Consider using read_file tool instead (auto-accepted, no approval needed)',
	head: 'Consider using read_file tool with start_line/end_line instead (auto-accepted, no approval needed)',
	tail: 'Consider using read_file tool with start_line/end_line instead (auto-accepted, no approval needed)',
	less: 'Consider using read_file tool instead (auto-accepted, no approval needed)',
	ls: 'Consider using list_directory tool instead (auto-accepted, no approval needed)',
	'ls -R':
		'Consider using list_directory tool with recursive=true instead (auto-accepted, no approval needed)',
};

/**
 * Detects if a command could use a native tool instead and returns the suggestion.
 * Handles both standalone commands and commands in pipelines.
 */
function detectToolAlternative(command: string): string | null {
	const trimmedCommand = command.trim();

	for (const [bashCmd, suggestion] of Object.entries(TOOL_ALTERNATIVES)) {
		// For multi-word patterns like "grep -r" or "ls -R", check if command starts with it
		if (bashCmd.includes(' ')) {
			if (
				trimmedCommand.startsWith(bashCmd + ' ') ||
				trimmedCommand === bashCmd
			) {
				return suggestion;
			}
			continue;
		}

		// For single-word commands, check various positions:
		// 1. Command at start: "grep foo" or "grep\tfoo"
		// 2. Command is the entire string: "ls"
		// 3. Command after pipe: "echo foo | grep bar"
		// 4. Command at end of pipe: "echo foo | grep"

		// Check if it's at the start or is the whole command
		if (
			trimmedCommand === bashCmd ||
			trimmedCommand.startsWith(`${bashCmd} `) ||
			trimmedCommand.startsWith(`${bashCmd}\t`)
		) {
			return suggestion;
		}

		// Check if it's in a pipeline using regex for proper word boundary
		// Match: | cmd or | cmd (args) at end or in middle of pipeline
		const pipePattern = new RegExp(`\\|\\s*${bashCmd}(?:\\s|$)`);
		if (pipePattern.test(trimmedCommand)) {
			return suggestion;
		}
	}

	return null;
}

const executeExecuteBash = async (args: {command: string}): Promise<string> => {
	return new Promise((resolve, reject) => {
		const proc = spawn('sh', ['-c', args.command]);
		let stdout = '';
		let stderr = '';

		proc.stdout.on('data', (data: Buffer) => {
			stdout += data.toString();
		});

		proc.stderr.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on('close', (code: number | null) => {
			let fullOutput = '';

			// Include exit code information
			const exitCodeInfo = code !== null ? `EXIT_CODE: ${code}\n` : '';

			if (stderr) {
				fullOutput = `${exitCodeInfo}STDERR:
${stderr}
STDOUT:
${stdout}`;
			} else {
				fullOutput = `${exitCodeInfo}${stdout}`;
			}

			// Limit the context for LLM to first TRUNCATION_OUTPUT_LIMIT characters to prevent overwhelming the model
			const llmContext =
				fullOutput.length > TRUNCATION_OUTPUT_LIMIT
					? fullOutput.substring(0, TRUNCATION_OUTPUT_LIMIT) +
						'\n... [Output truncated. Use more specific commands to see full output]'
					: fullOutput;

			// Return ONLY the llmContext to avoid sending massive outputs to the model
			// The formatter will need to be updated to handle plain strings
			resolve(llmContext);
		});

		proc.on('error', error => {
			reject(new Error(`Error executing command: ${error.message}`));
		});
	});
};

const executeBashCoreTool = tool({
	description:
		'Execute a bash command and return the output (use for running commands)',
	inputSchema: jsonSchema<{command: string}>({
		type: 'object',
		properties: {
			command: {
				type: 'string',
				description: 'The bash command to execute.',
			},
		},
		required: ['command'],
	}),
	// High risk: bash commands always require approval in all modes
	needsApproval: true,
	execute: async (args, _options) => {
		return await executeExecuteBash(args);
	},
});

// Create a component that will re-render when theme changes
const ExecuteBashFormatter = React.memo(
	({args, result}: {args: {command: string}; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext is required');
		}
		const {colors} = themeContext;
		const command = args.command || 'unknown';

		try {
			highlight(command, {
				language: 'bash',
				theme: 'default',
			});
		} catch {
			// Syntax highlighting failed, will use plain command
		}

		// Result is now a plain string (truncated output)
		let outputSize = 0;
		let estimatedTokens = 0;
		if (result) {
			outputSize = result.length;
			estimatedTokens = Math.ceil(outputSize / 4); // ~4 characters per token
		}

		// Detect if there's a tool alternative for this command
		const toolAlternative = detectToolAlternative(command);

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ execute_bash</Text>

				<Box>
					<Text color={colors.secondary}>Command: </Text>
					<Text color={colors.primary}>{command}</Text>
				</Box>

				{toolAlternative && (
					<Box>
						<Text color={colors.info}>{toolAlternative}</Text>
					</Box>
				)}

				{result && (
					<Box>
						<Text color={colors.secondary}>Output: </Text>
						<Text color={colors.white}>
							{outputSize} characters (~{estimatedTokens} tokens sent to LLM)
						</Text>
					</Box>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const executeBashFormatter = (
	args: {command: string},
	result?: string,
): React.ReactElement => {
	return <ExecuteBashFormatter args={args} result={result} />;
};

const executeBashValidator = (args: {
	command: string;
}): Promise<{valid: true} | {valid: false; error: string}> => {
	const command = args.command?.trim();

	// Check if command is empty
	if (!command) {
		return Promise.resolve({
			valid: false,
			error: '⚒ Command cannot be empty',
		});
	}

	// Check for extremely dangerous commands
	const dangerousPatterns = [
		/rm\s+-rf\s+\/(?!\w)/i, // rm -rf / (but allow /path)
		/mkfs/i, // Format filesystem
		/dd\s+if=/i, // Direct disk write
		/:(){:|:&};:/i, // Fork bomb
		/>\s*\/dev\/sd[a-z]/i, // Writing to raw disk devices
		/chmod\s+-R\s+000/i, // Remove all permissions recursively
	];

	for (const pattern of dangerousPatterns) {
		if (pattern.test(command)) {
			return Promise.resolve({
				valid: false,
				error: `⚒ Command contains potentially destructive operation: "${command}". This command is blocked for safety.`,
			});
		}
	}

	// Detect if this could be an exploration command with a native tool alternative
	const toolAlternative = detectToolAlternative(command);
	if (toolAlternative) {
		// For exploration commands, we still allow them but provide a helpful hint
		// This warning will be displayed to the user before they approve the command
		return Promise.resolve({
			valid: true, // Still valid, but we've detected a better alternative
		});
	}

	return Promise.resolve({valid: true});
};

export const executeBashTool: NanocoderToolExport = {
	name: 'execute_bash' as const,
	tool: executeBashCoreTool,
	formatter: executeBashFormatter,
	validator: executeBashValidator,
};
