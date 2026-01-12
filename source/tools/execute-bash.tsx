import {Box, Text} from 'ink';
import React from 'react';

import BashProgress from '@/components/bash-progress';
import {TRUNCATION_OUTPUT_LIMIT} from '@/constants';
import {useTheme} from '@/hooks/useTheme';
import {type BashExecutionState, bashExecutor} from '@/services/bash-executor';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';

/**
 * Execute a bash command using the bash executor service.
 * This is the internal implementation used by both the tool and direct !command mode.
 *
 * @param command - The bash command to execute
 * @returns Object containing executionId and promise for the result
 */
export function executeBashCommand(command: string): {
	executionId: string;
	promise: Promise<BashExecutionState>;
} {
	return bashExecutor.execute(command);
}

/**
 * Format bash execution result for LLM context
 */
export function formatBashResultForLLM(result: BashExecutionState): string {
	let fullOutput = '';
	const exitCodeInfo =
		result.exitCode !== null ? `EXIT_CODE: ${result.exitCode}\n` : '';

	if (result.stderr) {
		fullOutput = `${exitCodeInfo}STDERR:\n${result.stderr}\nSTDOUT:\n${result.fullOutput}`;
	} else {
		fullOutput = `${exitCodeInfo}${result.fullOutput}`;
	}

	// Handle errors
	if (result.error) {
		fullOutput = `Error: ${result.error}\n${fullOutput}`;
	}

	// Limit the context for LLM to prevent overwhelming the model
	const llmContext =
		fullOutput.length > TRUNCATION_OUTPUT_LIMIT
			? fullOutput.substring(0, TRUNCATION_OUTPUT_LIMIT) +
				'\n... [Output truncated. Use more specific commands to see full output]'
			: fullOutput;

	return llmContext;
}

/**
 * Tool execute function - called by the tool system
 * Note: For streaming tools, the tool handler will use executeBashCommand directly
 * and this function serves as a fallback/compatibility layer
 */
const executeExecuteBash = async (args: {command: string}): Promise<string> => {
	const {promise} = bashExecutor.execute(args.command);
	const result = await promise;
	return formatBashResultForLLM(result);
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
	// In plan mode, bash is completely disabled (blocked by approval requirement)
	needsApproval: true,
	execute: async (args, _options) => {
		return await executeExecuteBash(args);
	},
});

/**
 * Formatter component - used for tool confirmation preview
 */
function ExecuteBashFormatterComponent({
	command,
}: {
	command: string;
}): React.ReactElement {
	const {colors} = useTheme();

	return (
		<Box flexDirection="column">
			<Text color={colors.tool}>⚒ execute_bash</Text>
			<Box>
				<Text color={colors.secondary}>Command: </Text>
				<Box marginLeft={1}>
					<Text color={colors.primary}>{command}</Text>
				</Box>
			</Box>
		</Box>
	);
}

/**
 * Regular formatter - called for tool confirmation preview
 * Shows the command that will be executed
 */
const executeBashFormatter = (args: {command: string}): React.ReactElement => {
	return <ExecuteBashFormatterComponent command={args.command} />;
};

/**
 * Streaming formatter - called BEFORE execution to set up progress component
 * The component subscribes to bash executor events and updates itself
 */
const executeBashStreamingFormatter = (
	args: {command: string},
	executionId: string,
): React.ReactElement => {
	return <BashProgress executionId={executionId} command={args.command} />;
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

	return Promise.resolve({valid: true});
};

export const executeBashTool: NanocoderToolExport = {
	name: 'execute_bash' as const,
	tool: executeBashCoreTool,
	formatter: executeBashFormatter,
	streamingFormatter: executeBashStreamingFormatter,
	validator: executeBashValidator,
};
