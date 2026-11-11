import React from 'react';
import {commandRegistry} from '@/commands';
import {expandCommandAlias, findRetiredCommand} from '@/commands/aliases';
import CommandProgress from '@/components/command-progress';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import {parseCustomCommandArgs} from '@/custom-commands/args';
import {expandCustomCommandPrompt} from '@/custom-commands/executor';
import {generateKey} from '@/session/key-generator';
import {
	type CommandCompletion,
	type CommandContext,
	type CommandHandlerMetadata,
	isStatefulCommand,
	type MessageSubmissionOptions,
} from '@/types/index';
import {
	applyOnceOverrides,
	expandOverrideArgs,
	formatInlineToken,
	getOnceThreshold,
	isRecognizedOverrideKey,
	parseInlineOverrides,
} from '@/utils/inline-overrides';
import {infoMsg, warningMsg} from '@/utils/message-factory';
import {handleMCPPromptCommand} from './handlers/mcp-prompt-handler';

/**
 * Handles custom user-defined commands.
 * Returns true if a custom command was found and handled.
 */
async function handleCustomCommand(
	message: string,
	commandName: string,
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {
		customCommandCache,
		customCommandLoader,
		customCommandExecutor,
		onHandleChatMessage,
		onCommandComplete,
	} = options;

	const customCommand =
		customCommandCache.get(commandName) ||
		customCommandLoader?.getCommand(commandName);

	if (!customCommand) {
		return false;
	}

	const processedPrompt = customCommandExecutor
		? expandCustomCommandPrompt(customCommand, message, customCommandExecutor)
		: undefined;

	if (processedPrompt) {
		await onHandleChatMessage(processedPrompt);
	} else {
		onCommandComplete?.();
	}

	return true;
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
 * commands: the submission's `commandArgs` (VS Code context stripped) when
 * set, the split message otherwise.
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

/** Hand the prompt back the way the stateful command asked. */
function completeCommand(
	completion: Exclude<CommandCompletion, {show: unknown}>,
	options: MessageSubmissionOptions,
): void {
	if (completion === 'handed-off') return;
	if (typeof completion === 'object') {
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
	const {onAddToChatQueue, onCommandComplete, setLiveComponent, messages} =
		options;

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

	if (completion && typeof completion === 'object' && 'show' in completion) {
		result = completion.show;
	} else if (completion) {
		completeCommand(completion, options);
		return;
	}

	if (!result) {
		onCommandComplete?.();
		return;
	}

	if (React.isValidElement(result)) {
		queueMicrotask(() => {
			onAddToChatQueue(result);
		});
		setTimeout(() => {
			onCommandComplete?.();
		}, DELAY_COMMAND_COMPLETE_MS);
		return;
	}

	if (typeof result === 'string' && result.trim()) {
		queueMicrotask(() => {
			onAddToChatQueue(infoMsg(result, 'command-result'));
		});
		setTimeout(() => {
			onCommandComplete?.();
		}, DELAY_COMMAND_COMPLETE_MS);
		return;
	}

	onCommandComplete?.();
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

	if (await handleCustomCommand(message, commandName, options)) {
		return;
	}

	// #1162 (phase 2) proposed routing MCP prompts through
	// source/commands/lazy-registry.ts, the same way built-in commands are
	// dispatched. That registry is a static array of compile-time-known
	// commands, each with a dynamic-import() thunk - a shape that doesn't fit
	// prompts, whose entire set only exists at runtime and changes as MCP
	// servers connect/disconnect, and whose "load" is an RPC (getPrompt) to a
	// live server, not a module import. Intercepting here instead mirrors how
	// handleCustomCommand (checked just above) already dispatches the other
	// runtime-discovered command source - project `.nanocoder/commands/` files.
	// Both runtime-discovered sources bypass `?key=value` parsing below and
	// receive the raw message, so free-text `?word` tokens are never stripped.
	if (
		await handleMCPPromptCommand(
			commandName,
			parseCustomCommandArgs(message.slice(commandName.length + 2)),
			options,
		)
	) {
		return;
	}

	// Built-in names, aliases and retired names match in any case (`/Resume`).
	// Custom commands and MCP prompts above still match exactly.
	const builtInName = commandName.toLowerCase();
	const normalized = `/${builtInName}${message.slice(commandName.length + 1)}`;

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
