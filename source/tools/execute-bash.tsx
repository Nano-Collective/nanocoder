import {Box, Text} from 'ink';
import React from 'react';

import BashProgress from '@/components/bash-progress';
import {isNanocoderToolAlwaysAllowed} from '@/config/nanocoder-tools-config';
import {TRUNCATION_OUTPUT_LIMIT} from '@/constants';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {type BashExecutionState, bashExecutor} from '@/services/bash-executor';
import {getSafeSessionCwd} from '@/services/session-cwd';
import {
	buildFailureCapsule,
	type RerunCommand,
} from '@/tools/bash-failure-capsule';
import type {NanocoderToolExport, StructuredToolOutput} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {splitCommandForDisplay} from '@/utils/shell-command-display';
import {truncateToolResult} from '@/utils/truncate-tool-result';

/**
 * Execute a bash command using the bash executor service.
 * This is the internal implementation used by both the tool and direct !command mode.
 *
 * @param command - The bash command to execute
 * @returns Object containing executionId and promise for the result
 */
export function executeBashCommand(
	command: string,
	options?: {timeoutMs?: number; signal?: AbortSignal},
): {
	executionId: string;
	promise: Promise<BashExecutionState>;
} {
	return bashExecutor.execute(command, options);
}

/**
 * Whether a run failed: the command could not be spawned at all, or it exited
 * non-zero. The formatted output carries no `Error: ` prefix for a non-zero
 * exit - it is ordinary stdout/stderr - so this is what callers set
 * `ToolResult.isError` from, rather than sniffing the content.
 */
export function bashRunFailed(result: BashExecutionState): boolean {
	return result.error !== null || (result.exitCode ?? 0) !== 0;
}

function composeBashResult(result: BashExecutionState): string {
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
	return fullOutput;
}

/**
 * Format bash execution result for LLM context
 */
export function formatBashResultForLLM(result: BashExecutionState): string {
	// Limit the context for LLM to prevent overwhelming the model. Keeps both
	// head and tail, since build/test tooling puts the actionable part (error
	// list, failure summary, exit status) at the end.
	return truncateToolResult(composeBashResult(result), TRUNCATION_OUTPUT_LIMIT);
}

/**
 * What the model gets for a finished run. A failed run whose output is too
 * long to pass whole - so the head-and-tail cut would drop the failure detail
 * in the middle - becomes a failure capsule when its runner's format is
 * recognised. Everything else is `formatBashResultForLLM`.
 *
 * `rerun` lets the capsule confirm the failure with the narrowed command;
 * without it the output is only distilled.
 */
export async function distillBashResultForLLM(
	result: BashExecutionState,
	options: {rerun?: RerunCommand} = {},
): Promise<string> {
	const composed = composeBashResult(result);
	if (
		result.error === null &&
		bashRunFailed(result) &&
		composed.length > TRUNCATION_OUTPUT_LIMIT
	) {
		const capsule = await buildFailureCapsule(result, {
			cwd: getSafeSessionCwd(),
			originalLength: composed.length,
			rerun: options.rerun,
		});
		if (capsule) return capsule;
	}
	return truncateToolResult(composed, TRUNCATION_OUTPUT_LIMIT);
}

/**
 * Tool execute function - called by the tool system
 * Note: For streaming tools, the tool handler will use executeBashCommand directly
 * and this function serves as a fallback/compatibility layer
 */
interface ExecuteBashArgs {
	command: string;
	description?: string;
}

const executeExecuteBash = async (
	args: {command: string},
	options?: {abortSignal?: AbortSignal},
): Promise<StructuredToolOutput> => {
	const {promise} = bashExecutor.execute(args.command, {
		signal: options?.abortSignal,
	});
	const result = await promise;
	// The model still gets plain text; isError carries the exit status to
	// processToolUse, which is how --json and ACP learn the command failed.
	return {
		llmContent: await distillBashResultForLLM(result, {
			rerun: command =>
				options?.abortSignal?.aborted
					? Promise.resolve(null)
					: bashExecutor.execute(command, {signal: options?.abortSignal})
							.promise,
		}),
		isError: bashRunFailed(result),
	};
};

const executeBashCoreTool = tool({
	description:
		'Execute a bash command in the working directory. Returns stdout, stderr, and exit code. Commands time out after 2 minutes by default. Use for: running builds, tests, installing packages, git operations not covered by git tools, or any shell command.',
	inputSchema: jsonSchema<ExecuteBashArgs>({
		type: 'object',
		properties: {
			command: {
				type: 'string',
				description: 'The bash command to execute.',
			},
			description: {
				type: 'string',
				description:
					'Optional brief summary of the intent or purpose of this command.',
			},
		},
		required: ['command'],
	}),
	execute: async (args, options) => {
		return await executeExecuteBash(args, options);
	},
});

/**
 * Formatter component - used for tool confirmation preview
 */
function ExecuteBashFormatterComponent({
	command,
	description,
}: {
	command: string;
	description?: string;
}): React.ReactElement {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	return (
		<Box flexDirection="column" marginBottom={1} width={boxWidth}>
			<Text color={colors.tool}>⚒ execute_bash</Text>
			{description && (
				<Box flexDirection="column">
					<Text color={colors.secondary}>Description:</Text>
					<Text color={colors.text}> {description}</Text>
				</Box>
			)}
			<Box flexDirection="column">
				<Text color={colors.secondary}>Command:</Text>
				{splitCommandForDisplay(command).map((segment, i) => (
					<Text key={i} wrap="wrap" color={colors.primary}>
						{segment}
					</Text>
				))}
			</Box>
		</Box>
	);
}

/**
 * Regular formatter - called for tool confirmation preview
 * Shows the command that will be executed
 */
const executeBashFormatter = (args: ExecuteBashArgs): React.ReactElement => {
	return (
		<ExecuteBashFormatterComponent
			command={args.command}
			description={args.description}
		/>
	);
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

/**
 * Paths where a recursive force delete means wiping the machine or the user's
 * home rather than cleaning up a project. Anything deeper (`/tmp/build`,
 * `~/project/node_modules`) is ordinary cleanup and stays allowed.
 */
const DESTRUCTIVE_RM_TARGETS = new Set(['/', '~', '$HOME', '${HOME}']);

/**
 * Flags and targets of every `rm` in a command. Argument words stop at the
 * next command separator, so `rm -rf src && ls /` is judged on its own
 * arguments instead of folding the rest of the line into them.
 */
function rmArgumentLists(command: string): string[][] {
	const pattern = /\brm\b/gi;
	const lists: string[][] = [];
	let match = pattern.exec(command);
	while (match) {
		const rest = command.slice(match.index + match[0].length);
		const separator = rest.search(/[;&|\n]/);
		lists.push(
			(separator === -1 ? rest : rest.slice(0, separator))
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				// Quotes are how a path is written, not part of it: `rm -rf
				// "$HOME"` deletes the same directory as `rm -rf $HOME`.
				.map(word => word.replace(/['"]/g, '')),
		);
		match = pattern.exec(command);
	}
	return lists;
}

/**
 * Whether an `rm` target names the filesystem root or the user's home. `/*`,
 * `/.`, `/..`, `//` and `~/*` all name the same directory as `/` and `~`, so
 * globs, empty segments, and `.`/`..` segments are resolved before comparing.
 */
function isDestructiveRmTarget(target: string): boolean {
	// Anything that is not a plain name directly under `/` - `/*`, `/*/`,
	// `/*/*`, `/.*`, `/?`, `/{etc,usr}` - expands to the root's own entries and
	// is as destructive as naming `/`. A named path (`/tmp`, `/usr/local`) is
	// an ordinary target and is left to the checks below.
	if (/^\/(?!\w)/.test(target)) return true;

	const withoutGlob = target.replace(/\/\*+$/, '/');
	const resolved: string[] = [];
	for (const segment of withoutGlob.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			resolved.pop();
			continue;
		}
		resolved.push(segment);
	}
	const base = `${withoutGlob.startsWith('/') ? '/' : ''}${resolved.join('/')}`;
	return DESTRUCTIVE_RM_TARGETS.has(base);
}

/**
 * Whether an `rm` argument list asks for a recursive, forced delete of one of
 * the destructive targets. Flags are read one at a time so `-fr`, `-r -f`,
 * `-Rf`, `--recursive --force` and `--no-preserve-root` are all understood -
 * the single-regex check this replaced only knew the exact spelling `-rf`.
 */
function isDestructiveRm(words: string[]): boolean {
	let recursive = false;
	let forced = false;
	let overridesRootGuard = false;

	for (const word of words) {
		if (word === '--recursive') {
			recursive = true;
		} else if (word === '--force') {
			forced = true;
		} else if (word === '--no-preserve-root') {
			// This flag exists only to let `rm` past its own guard on `/`.
			overridesRootGuard = true;
		} else if (/^-[a-zA-Z]+$/.test(word)) {
			// `rm`'s own flags are case-sensitive (`-R` is recursive, `-r` too),
			// but the guard matches `rm` itself case-insensitively, so read the
			// cluster the same way rather than letting `RM -RF /` through.
			const flags = word.toLowerCase();
			recursive = recursive || flags.includes('r');
			forced = forced || flags.includes('f');
		}
	}

	if (!recursive || !(forced || overridesRootGuard)) return false;

	return words
		.filter(word => !word.startsWith('-'))
		.some(isDestructiveRmTarget);
}

const executeBashValidator = (args: {
	command: string;
}): Promise<{valid: true} | {valid: false; error: string}> => {
	const command = args.command?.trim();

	// Check if command is empty
	if (!command) {
		return Promise.resolve({
			valid: false,
			error: 'Command cannot be empty',
		});
	}

	// Check for extremely dangerous commands
	const dangerousPatterns = [
		/mkfs/i, // Format filesystem
		/dd\s+if=/i, // Direct disk write
		// Fork bomb: a function that pipes itself into itself in the background,
		// then is called, e.g. `:(){ :|:& };:` (any name, any spacing).
		/([^\s(){};|&]+)\s*\(\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\}\s*;\s*\1/,
		/>\s*\/dev\/sd[a-z]/i, // Writing to raw disk devices
		/chmod\s+-R\s+000/i, // Remove all permissions recursively
	];

	// A recursive force delete of `/`, `~` or `$HOME` is destructive however its
	// flags are spelled, so it is parsed rather than pattern-matched. Backslash
	// line continuations are joined first: `rm -rf \` with `/` on the next line
	// is one command, so the target has to stay attached to its flags.
	const parseable = command.replace(/\\\r?\n/g, ' ');
	const isDestructive =
		rmArgumentLists(parseable).some(isDestructiveRm) ||
		dangerousPatterns.some(pattern => pattern.test(command));

	if (isDestructive) {
		return Promise.resolve({
			valid: false,
			error: `Command contains potentially destructive operation: "${command}". This command is blocked for safety.`,
		});
	}

	return Promise.resolve({valid: true});
};

export const executeBashTool: NanocoderToolExport = {
	name: 'execute_bash' as const,
	tool: executeBashCoreTool,
	formatter: executeBashFormatter,
	streamingFormatter: executeBashStreamingFormatter,
	validator: executeBashValidator,
	// High risk: bash always requires approval unless explicitly always-allowed
	// or in headless mode. Even auto-accept still prompts for bash. (Yolo is
	// bypassed centrally by resolveToolApproval.)
	approval: (_args, mode) => {
		if (isNanocoderToolAlwaysAllowed('execute_bash')) return false;
		if (mode === 'headless') return false;
		return true;
	},
};
