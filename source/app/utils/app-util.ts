import React from 'react';
import {parseInput} from '@/command-parser';
import {commandRegistry} from '@/commands';
import {CodexLogin} from '@/commands/codex-login';
import {CopilotLogin} from '@/commands/copilot-login';
import BashProgress from '@/components/bash-progress';
import {DELAY_COMMAND_COMPLETE_MS, MAX_SESSION_NAME_LENGTH} from '@/constants';
import {CheckpointManager} from '@/services/checkpoint-manager';
import {generateKey} from '@/session/key-generator';
import {executeBashCommand, formatBashResultForLLM} from '@/tools/execute-bash';
import {clearAllTasks} from '@/tools/tasks/storage';
import type {ImageAttachment, LLMClient} from '@/types/core';
import type {Message, MessageSubmissionOptions} from '@/types/index';
import {formatError} from '@/utils/error-formatter';
import {errorMsg, infoMsg, successMsg} from '@/utils/message-factory';
import {clearReadTracker} from '@/utils/read-tracker';
import {handleCompactCommand} from './handlers/compact-handler';
import {handleContextMaxCommand} from './handlers/context-max-handler';
import {
	handleAgentCopy,
	handleAgentCreate,
	handleCommandCreate,
	handleSkillsCreate,
	handleToolCreate,
} from './handlers/create-handler';
import {handleRetryCommand} from './handlers/retry-handler';
import {handleResumeCommand} from './handlers/session-handler';

// Re-export for consumers that import parseContextLimit from here
export {parseContextLimit} from './handlers/context-max-handler';

/**
 * "Special commands" need access to app-level state (setting modes, mutating
 * messages, swapping live components) that the standard `Command.handler`
 * signature in `source/types` doesn't expose. They are registered in
 * `source/commands/` as stub handlers (so they appear in the slash menu and
 * `/help`) but actually dispatched here in `handleSpecialCommand` below.
 *
 * If you add a new entry here, also add a stub command file in
 * `source/commands/` and register it in `source/commands/lazy-registry.ts`.
 */
const SPECIAL_COMMANDS = {
	CLEAR: 'clear',
	MODEL: 'model',
	MODEL_DATABASE: 'model-database',
	SETUP_PROVIDERS: 'setup-providers',
	SETUP_MCP: 'setup-mcp',
	SETTINGS: 'settings',
	STATUS: 'status',
	CHECKPOINT: 'checkpoint',
	EXPLORER: 'explorer',
	IDE: 'ide',
	TUNE: 'tune',
	RENAME: 'rename',
} as const;

/** Checkpoint subcommands */
const CHECKPOINT_SUBCOMMANDS = {
	LOAD: 'load',
	RESTORE: 'restore',
} as const;

const ARGUMENT_QUOTE_CHARS = new Set(['"', "'", '`']);

/**
 * Parses command arguments while preserving quoted multi-word values.
 */
export function parseCustomCommandArgs(input: string): string[] {
	const args: string[] = [];
	let currentArg = '';
	let quoteChar: string | null = null;
	let isEscaped = false;
	let hasCurrentArg = false;

	for (const char of input.trim()) {
		if (isEscaped) {
			currentArg += char;
			hasCurrentArg = true;
			isEscaped = false;
			continue;
		}

		if (char === '\\') {
			isEscaped = true;
			hasCurrentArg = true;
			continue;
		}

		if (quoteChar) {
			if (char === quoteChar) {
				quoteChar = null;
			} else {
				currentArg += char;
			}
			hasCurrentArg = true;
			continue;
		}

		if (ARGUMENT_QUOTE_CHARS.has(char)) {
			quoteChar = char;
			hasCurrentArg = true;
			continue;
		}

		if (/\s/.test(char)) {
			if (hasCurrentArg) {
				args.push(currentArg);
				currentArg = '';
				hasCurrentArg = false;
			}
			continue;
		}

		currentArg += char;
		hasCurrentArg = true;
	}

	if (isEscaped) {
		currentArg += '\\';
		hasCurrentArg = true;
	}

	if (hasCurrentArg) {
		args.push(currentArg);
	}

	return args;
}

/**
 * Handles bash commands prefixed with !
 */
async function handleBashCommand(
	bashCommand: string,
	options: MessageSubmissionOptions,
): Promise<void> {
	const {
		onAddToChatQueue,
		setLiveComponent,
		setIsToolExecuting,
		onCommandComplete,
		setMessages,
		messages,
	} = options;

	setIsToolExecuting(true);

	try {
		const {executionId, promise} = executeBashCommand(bashCommand);

		setLiveComponent(
			React.createElement(BashProgress, {
				key: generateKey('bash-progress-live'),
				executionId,
				command: bashCommand,
				isLive: true,
			}),
		);

		const result = await promise;

		setLiveComponent(null);
		onAddToChatQueue(
			React.createElement(BashProgress, {
				key: generateKey('bash-progress-complete'),
				executionId,
				command: bashCommand,
				completedState: result,
			}),
		);

		const llmContext = formatBashResultForLLM(result);

		if (llmContext) {
			const userMessage: Message = {
				role: 'user',
				content: `Bash command output:\n\`\`\`\n$ ${bashCommand}\n${llmContext}\n\`\`\``,
			};
			setMessages([...messages, userMessage]);
		}
	} catch (error: unknown) {
		setLiveComponent(null);
		onAddToChatQueue(
			errorMsg(`Error executing command: ${formatError(error)}`, 'bash-error'),
		);
	} finally {
		setIsToolExecuting(false);
		onCommandComplete?.();
	}
}

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

	const args = parseCustomCommandArgs(message.slice(commandName.length + 2));

	const processedPrompt = customCommandExecutor?.execute(customCommand, args);

	if (processedPrompt) {
		await onHandleChatMessage(processedPrompt);
	} else {
		onCommandComplete?.();
	}

	return true;
}

/**
 * Handles special commands that need app state access (/clear, /model, etc.)
 * Returns true if a special command was handled.
 */
async function handleSpecialCommand(
	commandName: string,
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {
		onClearMessages,
		onRenameSession,
		onEnterModelSelectionMode,
		onEnterModelDatabaseMode,
		onEnterConfigWizardMode,
		onEnterSettingsMode,
		onEnterMcpWizardMode,
		onEnterExplorerMode,
		onShowStatus,
		onCommandComplete,
		onAddToChatQueue,
		commandArgs,
	} = options;

	// Commands that just switch the app into a mode and complete share the
	// exact same shape, so dispatch them from a table instead of the switch.
	const enterModeCommands: Record<string, () => void> = {
		[SPECIAL_COMMANDS.MODEL]: onEnterModelSelectionMode,
		[SPECIAL_COMMANDS.MODEL_DATABASE]: onEnterModelDatabaseMode,
		[SPECIAL_COMMANDS.SETUP_PROVIDERS]: onEnterConfigWizardMode,
		[SPECIAL_COMMANDS.SETUP_MCP]: onEnterMcpWizardMode,
		[SPECIAL_COMMANDS.SETTINGS]: onEnterSettingsMode,
		[SPECIAL_COMMANDS.EXPLORER]: onEnterExplorerMode,
		[SPECIAL_COMMANDS.IDE]: options.onEnterIdeSelectionMode,
		[SPECIAL_COMMANDS.TUNE]: options.onEnterTune,
	};

	const enterMode = enterModeCommands[commandName];
	if (enterMode) {
		enterMode();
		onCommandComplete?.();
		return true;
	}

	switch (commandName) {
		case SPECIAL_COMMANDS.CLEAR:
			await onClearMessages();
			await clearAllTasks();
			onAddToChatQueue(successMsg('Chat and tasks cleared.', 'clear-success'));
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;

		case SPECIAL_COMMANDS.STATUS:
			onShowStatus();
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;

		case SPECIAL_COMMANDS.RENAME: {
			const newName = commandArgs?.join(' ') || '';
			if (!newName.trim()) {
				onAddToChatQueue(
					errorMsg('Usage: /rename <session name>', 'rename-error'),
				);
			} else if (newName.length > MAX_SESSION_NAME_LENGTH) {
				onAddToChatQueue(
					errorMsg(
						`Session name must be ${MAX_SESSION_NAME_LENGTH} characters or less.`,
						'rename-error',
					),
				);
			} else {
				onRenameSession(newName.trim());
				onAddToChatQueue(
					successMsg(
						`Session renamed to "${newName.trim()}".`,
						'rename-success',
					),
				);
			}
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		}

		default:
			return false;
	}
}

/**
 * Handles interactive checkpoint load command.
 * Returns true if checkpoint load was handled.
 */
async function handleCheckpointLoad(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {
		onAddToChatQueue,
		onEnterCheckpointLoadMode,
		onCommandComplete,
		messages,
	} = options;

	const isCheckpointLoad =
		commandParts[0] === SPECIAL_COMMANDS.CHECKPOINT &&
		(commandParts[1] === CHECKPOINT_SUBCOMMANDS.LOAD ||
			commandParts[1] === CHECKPOINT_SUBCOMMANDS.RESTORE) &&
		commandParts.length === 2;

	if (!isCheckpointLoad) {
		return false;
	}

	try {
		const manager = new CheckpointManager();
		const checkpoints = await manager.listCheckpoints();

		if (checkpoints.length === 0) {
			onAddToChatQueue(
				infoMsg(
					'No checkpoints available. Create one with /checkpoint create [name]',
					'checkpoint-info',
				),
			);
			onCommandComplete?.();
			return true;
		}

		onEnterCheckpointLoadMode(checkpoints, messages.length);
		return true;
	} catch (error) {
		onAddToChatQueue(
			errorMsg(
				`Failed to list checkpoints: ${formatError(error)}`,
				'checkpoint-error',
			),
		);
		onCommandComplete?.();
		return true;
	}
}

/**
 * Handles /copilot-login as a live component.
 * Returns true if handled.
 */
function handleCopilotLogin(
	commandParts: string[],
	options: MessageSubmissionOptions,
): boolean {
	if (commandParts[0] !== 'copilot-login') {
		return false;
	}

	const {
		setLiveComponent,
		setIsToolExecuting,
		onAddToChatQueue,
		onCommandComplete,
	} = options;

	const providerName = commandParts[1]?.trim() || 'GitHub Copilot';

	setIsToolExecuting(true);

	setLiveComponent(
		React.createElement(CopilotLogin, {
			key: generateKey('copilot-login-live'),
			providerName,
			onDone: result => {
				setLiveComponent(null);
				setIsToolExecuting(false);

				if (result.success) {
					onAddToChatQueue(
						successMsg(
							`Logged in. Credentials saved for "${providerName}".`,
							'copilot-login-done',
						),
					);
				} else {
					onAddToChatQueue(
						errorMsg(result.error ?? 'Login failed.', 'copilot-login-error'),
					);
				}

				onCommandComplete?.();
			},
		}),
	);

	return true;
}

/**
 * Handles /codex-login as a live component.
 * Returns true if handled.
 */
function handleCodexLogin(
	commandParts: string[],
	options: MessageSubmissionOptions,
): boolean {
	if (commandParts[0] !== 'codex-login') {
		return false;
	}

	const {
		setLiveComponent,
		setIsToolExecuting,
		onAddToChatQueue,
		onCommandComplete,
	} = options;

	const providerName = commandParts[1]?.trim() || 'ChatGPT / Codex';

	setIsToolExecuting(true);

	setLiveComponent(
		React.createElement(CodexLogin, {
			key: generateKey('codex-login-live'),
			providerName,
			onDone: result => {
				setLiveComponent(null);
				setIsToolExecuting(false);

				if (result.success) {
					onAddToChatQueue(
						successMsg(
							`Logged in. Credentials saved for "${providerName}".`,
							'codex-login-done',
						),
					);
				} else {
					onAddToChatQueue(
						errorMsg(result.error ?? 'Login failed.', 'codex-login-error'),
					);
				}

				onCommandComplete?.();
			},
		}),
	);

	return true;
}

/**
 * Handles built-in commands via the command registry.
 */
async function handleBuiltInCommand(
	message: string,
	options: MessageSubmissionOptions,
): Promise<void> {
	const {
		onAddToChatQueue,
		onCommandComplete,
		messages,
		lastApiUsage,
		apiCallHistory,
	} = options;

	const totalTokens = messages.reduce(
		(sum, msg) => sum + options.getMessageTokens(msg),
		0,
	);

	const result = await commandRegistry.execute(message.slice(1), messages, {
		provider: options.provider,
		model: options.model,
		tokens: totalTokens,
		getMessageTokens: options.getMessageTokens,
		client: options.client,
		tune: options.tune,
		developmentMode: options.developmentMode,
		lastApiUsage,
		apiCallHistory,
	});

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
 * Handles slash commands (prefixed with /).
 */
async function handleSlashCommand(
	message: string,
	options: MessageSubmissionOptions,
): Promise<void> {
	const commandName = message.slice(1).split(/\s+/)[0];

	if (await handleCustomCommand(message, commandName, options)) {
		return;
	}

	const commandParts = message.slice(1).trim().split(/\s+/);

	if (await handleCompactCommand(commandParts, options)) return;
	if (await handleContextMaxCommand(commandParts, options)) return;
	if (await handleCommandCreate(commandParts, options)) return;
	if (await handleAgentCreate(commandParts, options)) return;
	if (await handleAgentCopy(commandParts, options)) return;
	if (await handleToolCreate(commandParts, options)) return;
	if (await handleSkillsCreate(commandParts, options)) return;
	if (await handleSpecialCommand(commandName, options)) return;
	if (await handleCheckpointLoad(commandParts, options)) return;
	// Stateful handlers that replay or resume chat flow live alongside each other.
	if (await handleResumeCommand(commandParts, options)) return;
	if (
		await handleRetryCommand(
			[
				commandName,
				...parseCustomCommandArgs(message.slice(commandName.length + 2)),
			],
			options,
		)
	)
		return;
	if (handleCopilotLogin(commandParts, options)) return;
	if (handleCodexLogin(commandParts, options)) return;

	await handleBuiltInCommand(message, options);
}

/**
 * Main entry point for handling user message submission.
 * Routes messages to appropriate handlers based on their type.
 */
export async function handleMessageSubmission(
	message: string,
	options: MessageSubmissionOptions,
	displayValue?: string,
	images?: ImageAttachment[],
): Promise<void> {
	const parsedInput = parseInput(message);

	if (parsedInput.isBashCommand && parsedInput.bashCommand) {
		await handleBashCommand(parsedInput.bashCommand, options);
		return;
	}

	if (message.startsWith('/')) {
		await handleSlashCommand(message, options);
		return;
	}

	await options.onHandleChatMessage(message, displayValue, images);
}

export function createClearMessagesHandler(
	setMessages: (messages: Message[]) => void,
	client: LLMClient | null,
) {
	return async () => {
		setMessages([]);
		// Drop read-before-edit history so a stale "seen" from the prior
		// conversation can't authorize a blind edit/overwrite after /clear.
		clearReadTracker();
		if (client) {
			await client.clearContext();
		}
	};
}
