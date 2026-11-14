import React from 'react';
import {commandRegistry} from '@/commands';
import {expandCommandAlias, findRetiredCommand} from '@/commands/aliases';
import CommandProgress from '@/components/command-progress';
import {errorMsg, infoMsg, warningMsg} from '@/components/message-factory';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import {
	applyOnceOverrides,
	expandOverrideArgs,
	formatInlineToken,
	getOnceThreshold,
	isRecognizedOverrideKey,
	parseInlineOverrides,
} from '@/conversation/compaction/inline-overrides';
import {parseCustomCommandArgs} from '@/custom-commands/args';
import {expandCustomCommandPrompt} from '@/custom-commands/executor';
import {
	type CommandCompletion,
	type CommandContext,
	type CommandHandlerMetadata,
	isStatefulCommand,
	type MessageSubmissionOptions,
} from '@/types/index';
import {generateKey} from '@/utils/key-generator';
import {handleMCPPromptCommand} from './handlers/mcp-prompt-handler';
import {stripVSCodeContext} from './vscode-context';

/**
 * Runs a custom user-defined command (`.nanocoder/commands/`, skill bundles):
 * its rendered body becomes the next chat turn, which completes it. Returns
 * `undefined` when no custom command has this name.
 */
async function runCustomCommand(
	message: string,
	commandName: string,
	options: MessageSubmissionOptions,
): Promise<CommandCompletion | undefined> {
	const {
		customCommandCache,
		customCommandLoader,
		customCommandExecutor,
		onHandleChatMessage,
	} = options;

	const customCommand =
		customCommandCache.get(commandName) ||
		customCommandLoader?.getCommand(commandName);

	if (!customCommand) {
		return undefined;
	}

	const processedPrompt = customCommandExecutor
		? expandCustomCommandPrompt(customCommand, message, customCommandExecutor)
		: undefined;

	if (!processedPrompt) {
		return 'done';
	}
	await onHandleChatMessage(processedPrompt);
	return 'handed-off';
}

/** What a read-only command's `handler` receives besides args and messages. */
function buildHandlerMetadata(
	options: MessageSubmissionOptions,
): CommandHandlerMetadata {
	return {
		provider: options.provider,
		model: options.model,
		tokens: options.messages.reduce(
			(sum, msg) => sum + options.getMessageTokens(msg),
			0,
		),
		getMessageTokens: options.getMessageTokens,
		client: options.client,
		tune: options.tune,
		developmentMode: options.developmentMode,
		lastApiUsage: options.lastApiUsage,
		apiCallHistory: options.apiCallHistory,
		sessionId: options.sessionId,
	};
}

/**
 * The app state a stateful command can reach. `args` follows the old special
 * commands: the submission's `commandArgs` when set, the split message
 * otherwise. Both, like `argText` and `rawArgs`, exclude the VS Code context.
 */
function createCommandContext(
	commandParts: string[],
	argText: string,
	options: MessageSubmissionOptions,
	onceThreshold: number | undefined,
): CommandContext {
	return {
		args: options.commandArgs ?? commandParts.slice(1),
		argText,
		rawArgs: argText.trim() ? argText.trim().split(/\s+/) : [],
		handlerMetadata: () => buildHandlerMetadata(options),
		messages: options.messages,
		setMessages: options.setMessages,
		provider: options.provider,
		model: options.model,
		client: options.client,
		providerConfig: options.providerConfig,
		onceThreshold,
		addToChatQueue: options.onAddToChatQueue,
		setLiveComponent: options.setLiveComponent,
		setLiveComponentCapturesInput: options.setLiveComponentCapturesInput,
		setIsToolExecuting: options.setIsToolExecuting,
		clearMessages: options.onClearMessages,
		notifyCleared: () => options.onClearCounterIncrement?.(),
		renameSession: options.onRenameSession,
		showStatus: options.onShowStatus,
		enterModelSelectionMode: options.onEnterModelSelectionMode,
		enterModelDatabaseMode: options.onEnterModelDatabaseMode,
		enterSettingsMode: options.onEnterSettingsMode,
		enterExplorerMode: options.onEnterExplorerMode,
		enterIdeSelectionMode: options.onEnterIdeSelectionMode,
		enterTune: options.onEnterTune,
		enterCheckpointLoadMode: options.onEnterCheckpointLoadMode,
		enterSessionSelectorMode: options.onEnterSessionSelectorMode,
		resumeSession: options.onResumeSession,
		switchModel: options.onSwitchModel,
		submitChatMessage: (message, displayValue) =>
			options.onHandleChatMessage(message, displayValue),
	};
}

/**
 * Hand the prompt back the way the command asked. Every slash command
 * completes through here.
 *
 * `done-after-render` still waits `DELAY_COMMAND_COMPLETE_MS` (100 ms).
 * Completion is what lets a non-interactive run (`nanocoder run "/cmd"`)
 * exit, and the output a command queues reaches the screen through React
 * state and Ink's next frame, neither of which reports back when it is
 * drawn. Completing at once could exit before that frame, losing the
 * output. The delay has done this job since cabbf0059. Replacing it needs
 * a "rendered" signal from the TUI; until then it stays, in this one place.
 */
function completeCommand(
	completion: CommandCompletion,
	options: MessageSubmissionOptions,
): void {
	if (completion === 'handed-off') return;
	if (typeof completion === 'object') {
		if ('show' in completion) {
			completeCommand(
				showResult(completion.show, options.onAddToChatQueue),
				options,
			);
			return;
		}
		const complete = () => options.onCommandComplete?.();
		void completion.until.then(complete, complete);
		return;
	}
	if (completion === 'done-after-render') {
		setTimeout(() => options.onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return;
	}
	options.onCommandComplete?.();
}

/**
 * Runs a command from the registry: a `StatefulCommand` with a
 * `CommandContext`, any other through its read-only `handler`.
 */
async function runRegisteredCommand(
	message: string,
	commandParts: string[],
	options: MessageSubmissionOptions,
	onceThreshold?: number,
): Promise<void> {
	const {onAddToChatQueue, setLiveComponent, messages} = options;

	// Commands that declare a progressLabel do slow work (LLM round-trip,
	// network) before returning their result component. Hold a spinner in the
	// live slot for the duration so the UI is not silent for seconds. Mount it
	// before any other work here — tokenizing a long transcript is itself
	// perceptible — and release it in `finally` so a throwing handler cannot
	// strand a spinner that never resolves.
	const commandName = message.slice(1).trim().split(/\s+/)[0];
	const command = commandRegistry.get(commandName);
	const progressLabel = command?.progressLabel;

	if (command?.echoInvocation) {
		onAddToChatQueue(infoMsg(`$ ${message.trim()}`, 'command-invocation'));
	}

	if (progressLabel) {
		setLiveComponent(
			React.createElement(CommandProgress, {
				key: generateKey(`${commandName}-progress`),
				label: progressLabel,
			}),
		);
	}

	let completion: CommandCompletion | undefined;
	let result: Awaited<ReturnType<typeof commandRegistry.execute>> = undefined;
	try {
		const loaded = await commandRegistry.load(commandName);
		if (loaded && isStatefulCommand(loaded)) {
			completion = await loaded.run(
				createCommandContext(
					commandParts,
					message.slice(commandName.length + 2),
					options,
					onceThreshold,
				),
			);
		} else {
			result = await commandRegistry.execute(
				message.slice(1),
				messages,
				buildHandlerMetadata(options),
			);
		}
	} finally {
		if (progressLabel) {
			setLiveComponent(null);
		}
	}

	completeCommand(completion ?? showResult(result, onAddToChatQueue), options);
}

/**
 * Queue what a read-only command (or a stateful one's `{show}`) returned,
 * and say how the command completes. Queued on a microtask so a result
 * produced during a render cannot update the app mid-render.
 */
function showResult(
	result: React.ReactNode | string | void,
	addToChatQueue: (component: React.ReactNode) => void,
): CommandCompletion {
	if (React.isValidElement(result)) {
		queueMicrotask(() => addToChatQueue(result));
		return 'done-after-render';
	}
	if (typeof result === 'string' && result.trim()) {
		queueMicrotask(() => addToChatQueue(infoMsg(result, 'command-result')));
		return 'done-after-render';
	}
	return 'done';
}

/**
 * Resolves a slash command (a trimmed message starting with `/`) and runs it.
 * Every slash command goes through here, in this order:
 *
 * 1. Custom commands (`.nanocoder/commands/`, skill bundles)
 * 2. MCP prompts
 * 3. Old command names (`aliases.ts`): retired ones forward with a notice,
 *    aliases are rewritten to their target
 * 4. Inline `?key=value` overrides, for the commands that read them
 * 5. Built-in commands from the registry. A `StatefulCommand` gets a
 *    `CommandContext`; a read-only `Command` gets its handler arguments.
 */
export async function dispatchSlashCommand(
	message: string,
	options: MessageSubmissionOptions,
): Promise<void> {
	const commandName = message.slice(1).split(/\s+/)[0];

	try {
		await dispatchResolvedCommand(message, commandName, options);
	} catch (error) {
		// A handler that throws must not take the app down: the rejection would
		// reach the process-level `unhandledRejection` handler, which starts a
		// shutdown. Report it in the chat instead and complete the turn, so the
		// session (and a non-interactive `nanocoder run "/cmd"`) keeps going.
		options.onAddToChatQueue(
			errorMsg(
				`/${commandName} failed: ${error instanceof Error ? error.message : String(error)}`,
				`command-failed-${commandName}`,
			),
		);
		completeCommand('done-after-render', options);
	}
}

/**
 * The resolution chain behind `dispatchSlashCommand`. Throws whatever a
 * command throws, for `dispatchSlashCommand` to report.
 */
async function dispatchResolvedCommand(
	message: string,
	commandName: string,
	options: MessageSubmissionOptions,
): Promise<void> {
	const custom = await runCustomCommand(message, commandName, options);
	if (custom) {
		completeCommand(custom, options);
		return;
	}

	// #1162 (phase 2) proposed routing MCP prompts through
	// source/commands/lazy-registry.ts, the same way built-in commands are
	// dispatched. That registry is a static array of compile-time-known
	// commands, each with a dynamic-import() thunk - a shape that doesn't fit
	// prompts, whose entire set only exists at runtime and changes as MCP
	// servers connect/disconnect, and whose "load" is an RPC (getPrompt) to a
	// live server, not a module import. Intercepting here instead mirrors how
	// runCustomCommand (checked just above) already dispatches the other
	// runtime-discovered command source - project `.nanocoder/commands/` files.
	// Both runtime-discovered sources bypass `?key=value` parsing below and
	// receive the raw message, so free-text `?word` tokens are never stripped.
	const mcpPrompt = await handleMCPPromptCommand(
		commandName,
		parseCustomCommandArgs(message.slice(commandName.length + 2)),
		options,
	);
	if (mcpPrompt) {
		completeCommand(mcpPrompt, options);
		return;
	}

	// Built-in names, aliases and retired names match in any case (`/Resume`).
	// Custom commands and MCP prompts above still match exactly. The VS Code
	// editor selection appended to the prompt is not an argument of a
	// built-in, so it is dropped here, matching the `commandArgs` that
	// useAppHandlers strips (custom commands and MCP prompts keep it).
	const builtInName = commandName.toLowerCase();
	const normalized = `/${builtInName}${stripVSCodeContext(message).slice(commandName.length + 1)}`;

	// Retired names (/setup-providers, ...) say where they moved, then run it.
	const retired = findRetiredCommand(builtInName);
	if (retired) {
		options.onAddToChatQueue(
			infoMsg(retired.notice, `${retired.name}-retired`),
		);
		await handleRegisteredSlashCommand(
			`/${[retired.target, ...retired.args].join(' ')}`,
			{...options, commandArgs: [...retired.args]},
		);
		return;
	}

	// Old command names (/quit, /remember, /codex-login, ...) are rewritten to
	// the command they were folded into. Done after the custom-command and MCP
	// checks so a project command that shares an old name still wins, as it
	// did before the rename.
	const expanded = expandCommandAlias(normalized);
	if (expanded === normalized) {
		await handleRegisteredSlashCommand(normalized, options);
		return;
	}
	await handleRegisteredSlashCommand(expanded, {
		...options,
		commandArgs: expanded.slice(1).trim().split(/\s+/).slice(1),
	});
}

/**
 * Handles a slash command that resolves to a built-in (registry) command.
 */
async function handleRegisteredSlashCommand(
	message: string,
	options: MessageSubmissionOptions,
): Promise<void> {
	const rawParts = message.slice(1).trim().split(/\s+/);
	const commandName = rawParts[0];

	// Only commands that actually read once-scoped settings parse inline
	// overrides. Every other command - especially free-text ones like
	// `/remember` or `/tasks add` - receives its args untouched, so a
	// literal `?word` is never reordered, expanded into a flag or warned on.
	if (!INLINE_OVERRIDE_COMMANDS.has(commandName)) {
		await runRegisteredCommand(message, rawParts, options);
		return;
	}

	// ?key=value tokens let a user test a per-session setting for one
	// command without committing it to the session. Recognised keys are
	// consumed here: once-scoped settings via the session-override stores
	// (restored in `finally`), legacy boolean flags by expanding them to
	// their `--flag` form. Anything else is forwarded to the command
	// handler verbatim (rebuilt into `commandParts`/`cleanedMessage`) so
	// each command's own unknown-arg handling runs - and surfaced once as
	// a warning so a typo like `?threshhold=80` cannot silently no-op.
	const {args: positional, overrides} = parseInlineOverrides(rawParts.slice(1));
	const recognized = overrides.filter(o => isRecognizedOverrideKey(o.key));
	const passthrough = overrides
		.filter(o => !isRecognizedOverrideKey(o.key))
		.map(formatInlineToken);
	const expandedFlags = expandOverrideArgs(recognized);
	const restTokens = [...positional, ...passthrough, ...expandedFlags].join(
		' ',
	);
	const cleanedMessage = restTokens
		? `/${commandName} ${restTokens}`
		: `/${commandName}`;
	const restoreOnce = await applyOnceOverrides(recognized);
	// Explicit once-context for consumers: unlike the session store (which
	// cannot tell a once-override apart from a persisted one), this is only
	// set when the user typed `?threshold=` on this command.
	const onceThreshold = getOnceThreshold(recognized);
	try {
		if (passthrough.length > 0) {
			const keys = [...new Set(passthrough)].join(', ');
			options.onAddToChatQueue(
				warningMsg(
					`Unknown inline override(s): ${keys} - no once-scoped setting or flag matches. Forwarded to the command unchanged.`,
					'inline-override-unknown',
				),
			);
		}

		await runRegisteredCommand(
			cleanedMessage,
			[commandName, ...positional, ...passthrough, ...expandedFlags],
			options,
			onceThreshold,
		);
	} finally {
		restoreOnce();
	}
}

/**
 * Built-in commands that accept inline `?key=value` overrides. These are the
 * commands whose handlers observe the once-scoped settings (`/usage` reads
 * the context limit, `/compact` the threshold and its boolean flags).
 */
const INLINE_OVERRIDE_COMMANDS: ReadonlySet<string> = new Set([
	'compact',
	'usage',
]);
