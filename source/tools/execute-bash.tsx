import {Box, Text} from 'ink';
import React from 'react';

import BashProgress from '@/components/bash-progress';
import {isNanocoderToolAlwaysAllowed} from '@/config/nanocoder-tools-config';
import {
	TIMEOUT_BASH_DEFAULT_MS,
	TIMEOUT_EXECUTION_MAX_MS,
	TRUNCATION_OUTPUT_LIMIT,
} from '@/constants';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {type BashExecutionState, bashExecutor} from '@/services/bash-executor';
import {getSafeSessionCwd} from '@/services/session-cwd';
import {splitCommandForDisplay} from '@/terminal/shell-command-display';
import {
	buildFailureCapsule,
	type RerunCommand,
} from '@/tools/bash-failure-capsule';
import {truncateToolResult} from '@/tools/runtime/truncate-tool-result';
import type {NanocoderToolExport, StructuredToolOutput} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';

/**
 * Bounds on the per-call timeout. The default is what the executor already
 * applies when no option is passed; the ceiling is the hard limit the rest of
 * the app uses for a single tool execution.
 */
const EXECUTE_BASH_MIN_TIMEOUT_SECONDS = 1;
const EXECUTE_BASH_MAX_TIMEOUT_SECONDS = TIMEOUT_EXECUTION_MAX_MS / 1000;
const EXECUTE_BASH_DEFAULT_TIMEOUT_SECONDS = TIMEOUT_BASH_DEFAULT_MS / 1000;

/**
 * Millisecond timeout for a call. `timeout_seconds` is clamped rather than
 * rejected: a model asking for 10 minutes gets the 5 minute ceiling and a
 * model asking for 0 gets one second, and the timeout message reports the
 * limit that was actually applied.
 */
export function resolveBashTimeoutMs(timeoutSeconds?: number): number {
	if (typeof timeoutSeconds !== 'number' || !Number.isFinite(timeoutSeconds)) {
		return TIMEOUT_BASH_DEFAULT_MS;
	}
	return (
		Math.min(
			EXECUTE_BASH_MAX_TIMEOUT_SECONDS,
			Math.max(EXECUTE_BASH_MIN_TIMEOUT_SECONDS, Math.floor(timeoutSeconds)),
		) * 1000
	);
}

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
	timeout_seconds?: number;
}

const executeExecuteBash = async (
	args: {command: string; timeout_seconds?: number},
	options?: {abortSignal?: AbortSignal},
): Promise<StructuredToolOutput> => {
	const timeoutMs = resolveBashTimeoutMs(args.timeout_seconds);
	const {promise} = bashExecutor.execute(args.command, {
		timeoutMs,
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
					: bashExecutor.execute(command, {
							timeoutMs,
							signal: options?.abortSignal,
						}).promise,
		}),
		isError: bashRunFailed(result),
	};
};

const executeBashCoreTool = tool({
	description:
		'Execute a bash command in the working directory. Returns stdout, stderr, and exit code. Commands time out after 2 minutes by default. Pass timeout_seconds to change that: raise it for a long build, test suite or install, or lower it for a command that should return quickly. Use for: running builds, tests, installing packages, git operations not covered by git tools, or any shell command.',
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
			timeout_seconds: {
				type: 'integer',
				description:
					'Optional time limit before the command is killed, in seconds. Defaults to 120 and is clamped to the 300 second maximum; a killed command reports the limit that was applied.',
				minimum: EXECUTE_BASH_MIN_TIMEOUT_SECONDS,
				maximum: EXECUTE_BASH_MAX_TIMEOUT_SECONDS,
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
	timeoutSeconds,
}: {
	command: string;
	description?: string;
	timeoutSeconds?: number;
}): React.ReactElement {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const appliedTimeoutSeconds = resolveBashTimeoutMs(timeoutSeconds) / 1000;
	// Only a non-default limit is worth a line: every other command would
	// repeat the same 2 minutes the tool description already states.
	const showTimeout =
		appliedTimeoutSeconds !== EXECUTE_BASH_DEFAULT_TIMEOUT_SECONDS;

	return (
		<Box flexDirection="column" marginBottom={1} width={boxWidth}>
			<Text color={colors.tool}>⚒ execute_bash</Text>
			{description && (
				<Box flexDirection="column">
					<Text color={colors.secondary}>Description:</Text>
					<Text color={colors.text}> {description}</Text>
				</Box>
			)}
			{showTimeout && (
				<Box flexDirection="column">
					<Text color={colors.secondary}>Timeout:</Text>
					<Text color={colors.text}> {appliedTimeoutSeconds} seconds</Text>
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
			timeoutSeconds={args.timeout_seconds}
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

/**
 * Commands that run a quoted string as shell code, so the quoted text is what
 * executes: `bash -c "..."`, `sh -lc '...'`, `eval "..."`, `ssh host "..."`,
 * `xargs sh -c ...`.
 */
const RUNS_QUOTED_TEXT =
	/\b(?:ba|z|k|da|fi|tc|c)?sh\s+(?:-\w+\s+)*-\w*c\b|\b(?:eval|ssh|xargs)\b/;

/**
 * The command with its quoted arguments blanked out, so `grep "dd if=" log`
 * or `echo 'never run mkfs'` is judged on what runs rather than on the text it
 * passes around. A quoted span in command position (`"mkfs" /dev/sda`) or
 * after a redirect (`> "/dev/sda"`) is what runs or what gets written, so its
 * quotes are dropped and its text kept. A command that hands a quoted string
 * to another shell is returned unchanged.
 */
function withoutQuotedArguments(command: string): string {
	if (RUNS_QUOTED_TEXT.test(command)) return command;
	return command.replace(
		/"(?:[^"\\]|\\.)*"|'[^']*'/g,
		(span, offset: number) =>
			/(?:^|[;&|(`\n>]|\bsudo)\s*$/.test(command.slice(0, offset))
				? span.slice(1, -1)
				: "''",
	);
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

	// Refuse a few commands that are catastrophic if run by accident. This is a
	// guard against a model's mistakes, not a security boundary: the shell has
	// endless ways to spell any of these (variables, `$(...)`, a script written
	// to disk first). Approval prompts and the opt-in OS sandbox are what
	// actually constrain execute_bash.
	const dangerousPatterns = [
		/\bmkfs\b/i, // Format filesystem
		/\bdd\s+if=/i, // Direct disk write
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
	const unquoted = withoutQuotedArguments(command);
	const isDestructive =
		rmArgumentLists(parseable).some(isDestructiveRm) ||
		dangerousPatterns.some(pattern => pattern.test(unquoted));

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
