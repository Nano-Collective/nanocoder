import React from 'react';
import {parseInput} from '@/command-parser';
import {commandRegistry} from '@/commands';
import {CodexLogin} from '@/commands/codex-login';
import {CopilotLogin} from '@/commands/copilot-login';
import BashProgress from '@/components/bash-progress';
import {
	ErrorMessage,
	InfoMessage,
	SuccessMessage,
} from '@/components/message-box';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import {CheckpointManager} from '@/services/checkpoint-manager';
import {executeBashCommand, formatBashResultForLLM} from '@/tools/execute-bash';
import {clearAllTasks} from '@/tools/tasks/storage';
import type {LLMClient} from '@/types/core';
import type {Message, MessageSubmissionOptions} from '@/types/index';
import {handleCompactCommand} from './handlers/compact-handler';
import {handleContextMaxCommand} from './handlers/context-max-handler';
import {
	handleAgentCopy,
	handleAgentCreate,
	handleCommandCreate,
	handleScheduleCreate,
	handleScheduleStart,
} from './handlers/create-handler';
import {handleResumeCommand} from './handlers/session-handler';

// Re-export for consumers that import parseContextLimit from here
export {parseContextLimit} from './handlers/context-max-handler';

/** Command names that require special handling in the app */
const SPECIAL_COMMANDS = {
	CLEAR: 'clear',
	MODEL: 'model',
	PROVIDER: 'provider',
	MODEL_DATABASE: 'model-database',
	SETUP_PROVIDERS: 'setup-providers',
	SETUP_MCP: 'setup-mcp',
	SETTINGS: 'settings',
	STATUS: 'status',
	CHECKPOINT: 'checkpoint',
	EXPLORER: 'explorer',
	IDE: 'ide',
	TUNE: 'tune',
} as const;

/** Checkpoint subcommands */
const CHECKPOINT_SUBCOMMANDS = {
	LOAD: 'load',
	RESTORE: 'restore',
} as const;

/**
 * Extracts error message from an unknown error
 */
function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
	return error instanceof Error ? error.message : fallback;
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
		getNextComponentKey,
		setMessages,
		messages,
	} = options;

	setIsToolExecuting(true);

	try {
		const {executionId, promise} = executeBashCommand(bashCommand);

		setLiveComponent(
			React.createElement(BashProgress, {
				key: `bash-progress-live-${getNextComponentKey()}`,
				executionId,
				command: bashCommand,
				isLive: true,
			}),
		);

		const result = await promise;

		setLiveComponent(null);
		onAddToChatQueue(
			React.createElement(BashProgress, {
				key: `bash-progress-complete-${getNextComponentKey()}`,
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
			React.createElement(ErrorMessage, {
				key: `bash-error-${getNextComponentKey()}`,
				message: `Error executing command: ${getErrorMessage(error, String(error))}`,
			}),
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

	const args = message
		.slice(commandName.length + 2)
		.trim()
		.split(/\s+/)
		.filter(arg => arg);

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
		onEnterModelSelectionMode,
		onEnterProviderSelectionMode,
		onEnterModelDatabaseMode,
		onEnterConfigWizardMode,
		onEnterSettingsMode,
		onEnterMcpWizardMode,
		onEnterExplorerMode,
		onShowStatus,
		onCommandComplete,
		onAddToChatQueue,
		getNextComponentKey,
	} = options;

	switch (commandName) {
		case SPECIAL_COMMANDS.CLEAR:
			await onClearMessages();
			await clearAllTasks();
			onAddToChatQueue(
				React.createElement(SuccessMessage, {
					key: `clear-success-${getNextComponentKey()}`,
					message: 'Chat and tasks cleared.',
					hideBox: true,
				}),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;

		case SPECIAL_COMMANDS.MODEL:
			onEnterModelSelectionMode();
			onCommandComplete?.();
			return true;

		case SPECIAL_COMMANDS.PROVIDER:
			onEnterProviderSelectionMode();
			onCommandComplete?.();
			return true;

		case SPECIAL_COMMANDS.MODEL_DATABASE:
			onEnterModelDatabaseMode();
			onCommandComplete?.();
			return true;

		case SPECIAL_COMMANDS.SETUP_PROVIDERS:
			onEnterConfigWizardMode();
			onCommandComplete?.();
			return true;

		case SPECIAL_COMMANDS.SETUP_MCP:
			onEnterMcpWizardMode();
			onCommandComplete?.();
			return true;

		case SPECIAL_COMMANDS.SETTINGS:
			onEnterSettingsMode();
			onCommandComplete?.();
			return true;

		case SPECIAL_COMMANDS.STATUS:
			onShowStatus();
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;

		case SPECIAL_COMMANDS.EXPLORER:
			onEnterExplorerMode();
			onCommandComplete?.();
			return true;

		case SPECIAL_COMMANDS.IDE:
			options.onEnterIdeSelectionMode();
			onCommandComplete?.();
			return true;

		case SPECIAL_COMMANDS.TUNE:
			options.onEnterTune();
			onCommandComplete?.();
			return true;

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
		getNextComponentKey,
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
				React.createElement(InfoMessage, {
					key: `checkpoint-info-${getNextComponentKey()}`,
					message:
						'No checkpoints available. Create one with /checkpoint create [name]',
					hideBox: true,
				}),
			);
			onCommandComplete?.();
			return true;
		}

		onEnterCheckpointLoadMode(checkpoints, messages.length);
		return true;
	} catch (error) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `checkpoint-error-${getNextComponentKey()}`,
				message: `Failed to list checkpoints: ${getErrorMessage(error)}`,
				hideBox: true,
			}),
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
		getNextComponentKey,
	} = options;

	const providerName = commandParts[1]?.trim() || 'GitHub Copilot';

	setIsToolExecuting(true);

	setLiveComponent(
		React.createElement(CopilotLogin, {
			key: `copilot-login-live-${getNextComponentKey()}`,
			providerName,
			onDone: result => {
				setLiveComponent(null);
				setIsToolExecuting(false);

				if (result.success) {
					onAddToChatQueue(
						React.createElement(SuccessMessage, {
							key: `copilot-login-done-${getNextComponentKey()}`,
							message: `Logged in. Credentials saved for "${providerName}".`,
							hideBox: true,
						}),
					);
				} else {
					onAddToChatQueue(
						React.createElement(ErrorMessage, {
							key: `copilot-login-error-${getNextComponentKey()}`,
							message: result.error ?? 'Login failed.',
							hideBox: true,
						}),
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
		getNextComponentKey,
	} = options;

	const providerName = commandParts[1]?.trim() || 'ChatGPT / Codex';

	setIsToolExecuting(true);

	setLiveComponent(
		React.createElement(CodexLogin, {
			key: `codex-login-live-${getNextComponentKey()}`,
			providerName,
			onDone: result => {
				setLiveComponent(null);
				setIsToolExecuting(false);

				if (result.success) {
					onAddToChatQueue(
						React.createElement(SuccessMessage, {
							key: `codex-login-done-${getNextComponentKey()}`,
							message: `Logged in. Credentials saved for "${providerName}".`,
							hideBox: true,
						}),
					);
				} else {
					onAddToChatQueue(
						React.createElement(ErrorMessage, {
							key: `codex-login-error-${getNextComponentKey()}`,
							message: result.error ?? 'Login failed.',
							hideBox: true,
						}),
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
	const {onAddToChatQueue, onCommandComplete, getNextComponentKey, messages} =
		options;

	const totalTokens = messages.reduce(
		(sum, msg) => sum + options.getMessageTokens(msg),
		0,
	);

	const result = await commandRegistry.execute(message.slice(1), messages, {
		provider: options.provider,
		model: options.model,
		tokens: totalTokens,
		getMessageTokens: options.getMessageTokens,
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
			onAddToChatQueue(
				React.createElement(InfoMessage, {
					key: `command-result-${getNextComponentKey()}`,
					message: result,
					hideBox: true,
				}),
			);
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
	if (await handleScheduleStart(commandParts, options)) return;
	if (await handleScheduleCreate(commandParts, options)) return;
	if (await handleCommandCreate(commandParts, options)) return;
	if (await handleAgentCreate(commandParts, options)) return;
	if (await handleAgentCopy(commandParts, options)) return;
	if (await handleSpecialCommand(commandName, options)) return;
	if (await handleCheckpointLoad(commandParts, options)) return;
	if (await handleResumeCommand(commandParts, options)) return;
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

	await options.onHandleChatMessage(message);
}

export function createClearMessagesHandler(
	setMessages: (messages: Message[]) => void,
	client: LLMClient | null,
) {
	return async () => {
		setMessages([]);
		if (client) {
			await client.clearContext();
		}
	};
}
