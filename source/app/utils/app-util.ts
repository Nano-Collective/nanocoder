import React from 'react';
import {parseInput} from '@/command-parser';
import {commandRegistry} from '@/commands';
import BashProgress from '@/components/bash-progress';
import {
	ErrorMessage,
	InfoMessage,
	SuccessMessage,
} from '@/components/message-box';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import {CheckpointManager} from '@/services/checkpoint-manager';
import {executeBashCommand, formatBashResultForLLM} from '@/tools/execute-bash';
import type {LLMClient} from '@/types/core';
import type {Message, MessageSubmissionOptions} from '@/types/index';

/** Command names that require special handling in the app */
const SPECIAL_COMMANDS = {
	CLEAR: 'clear',
	MODEL: 'model',
	PROVIDER: 'provider',
	THEME: 'theme',
	MODEL_DATABASE: 'model-database',
	SETUP_PROVIDERS: 'setup-providers',
	SETUP_MCP: 'setup-mcp',
	STATUS: 'status',
	CHECKPOINT: 'checkpoint',
	TITLE_SHAPE: 'title-shape',
	NANOCODER_SHAPE: 'nanocoder-shape',
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
 * Uses the unified bash executor service for real-time progress updates
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

	// Block user input while executing
	setIsToolExecuting(true);

	try {
		// Start execution and get the execution ID
		const {executionId, promise} = executeBashCommand(bashCommand);

		// Set as live component for real-time updates (renders outside Static)
		setLiveComponent(
			React.createElement(BashProgress, {
				key: `bash-progress-live-${getNextComponentKey()}`,
				executionId,
				command: bashCommand,
				isLive: true,
			}),
		);

		// Wait for execution to complete
		const result = await promise;

		// Clear live component and add static completed version to chat queue
		setLiveComponent(null);
		onAddToChatQueue(
			React.createElement(BashProgress, {
				key: `bash-progress-complete-${getNextComponentKey()}`,
				executionId,
				command: bashCommand,
				completedState: result,
			}),
		);

		// Format result for LLM context
		const llmContext = formatBashResultForLLM(result);

		// Add the output to the LLM context for future interactions
		if (llmContext) {
			const userMessage: Message = {
				role: 'user',
				content: `Bash command output:\n\`\`\`\n$ ${bashCommand}\n${llmContext}\n\`\`\``,
			};
			setMessages([...messages, userMessage]);
		}
	} catch (error: unknown) {
		// Clear live component on error
		setLiveComponent(null);
		// Show error message if command fails
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `bash-error-${getNextComponentKey()}`,
				message: `Error executing command: ${getErrorMessage(error, String(error))}`,
			}),
		);
	} finally {
		// Re-enable user input
		setIsToolExecuting(false);
		// Signal completion for non-interactive mode
		onCommandComplete?.();
	}
}

/**
 * Handles custom user-defined commands
 * Returns true if a custom command was found and handled
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

	// Execute custom command with any arguments
	// Slice past '/' + commandName + space to get the arguments
	const args = message
		.slice(commandName.length + 2)
		.trim()
		.split(/\s+/)
		.filter(arg => arg);

	const processedPrompt = customCommandExecutor?.execute(customCommand, args);

	// Send the processed prompt to the AI
	if (processedPrompt) {
		await onHandleChatMessage(processedPrompt);
	} else {
		// Custom command didn't generate a prompt, signal completion
		onCommandComplete?.();
	}

	return true;
}

/**
 * Handles special commands that need app state access (/clear, /model, etc.)
 * Returns true if a special command was handled
 */
async function handleSpecialCommand(
	commandName: string,
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {
		onClearMessages,
		onEnterModelSelectionMode,
		onEnterProviderSelectionMode,
		onEnterThemeSelectionMode,
		onEnterTitleShapeSelectionMode,
		onEnterNanocoderShapeSelectionMode,
		onEnterModelDatabaseMode,
		onEnterConfigWizardMode,
		onEnterMcpWizardMode,
		onShowStatus,
		onCommandComplete,
		onAddToChatQueue,
		getNextComponentKey,
	} = options;

	switch (commandName) {
		case SPECIAL_COMMANDS.CLEAR:
			await onClearMessages();
			// Show success message
			onAddToChatQueue(
				React.createElement(SuccessMessage, {
					key: `clear-success-${getNextComponentKey()}`,
					message: 'Chat cleared.',
					hideBox: true,
				}),
			);
			// Give React time to render before signaling completion
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

		case SPECIAL_COMMANDS.THEME:
			onEnterThemeSelectionMode();
			onCommandComplete?.();
			return true;

		case SPECIAL_COMMANDS.TITLE_SHAPE:
			onEnterTitleShapeSelectionMode();
			onCommandComplete?.();
			return true;

		case SPECIAL_COMMANDS.NANOCODER_SHAPE:
			onEnterNanocoderShapeSelectionMode();
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

		case SPECIAL_COMMANDS.STATUS:
			onShowStatus();
			// Status adds to queue synchronously, give React time to render
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;

		default:
			return false;
	}
}

/**
 * Handles interactive checkpoint load command
 * Returns true if checkpoint load was handled
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

	// Check if this is an interactive checkpoint load command
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
 * Handles built-in commands via the command registry
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

	// Handle React element result
	if (React.isValidElement(result)) {
		// Defer adding to chat queue to avoid "Cannot update a component while rendering" error
		queueMicrotask(() => {
			onAddToChatQueue(result);
		});
		// Give React time to render before signaling completion
		setTimeout(() => {
			onCommandComplete?.();
		}, DELAY_COMMAND_COMPLETE_MS);
		return;
	}

	// Handle string result
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
		// Give React time to render before signaling completion
		setTimeout(() => {
			onCommandComplete?.();
		}, DELAY_COMMAND_COMPLETE_MS);
		return;
	}

	// No output to display, signal completion immediately
	onCommandComplete?.();
}

/**
 * Handles slash commands (prefixed with /)
 */
async function handleSlashCommand(
	message: string,
	options: MessageSubmissionOptions,
): Promise<void> {
	const commandName = message.slice(1).split(/\s+/)[0];

	// Try custom command first
	if (await handleCustomCommand(message, commandName, options)) {
		return;
	}

	// Try special command
	if (await handleSpecialCommand(commandName, options)) {
		return;
	}

	// Try checkpoint load
	const commandParts = message.slice(1).trim().split(/\s+/);
	if (await handleCheckpointLoad(commandParts, options)) {
		return;
	}

	// Fall back to built-in command
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

	// Handle bash commands (prefixed with !)
	if (parsedInput.isBashCommand && parsedInput.bashCommand) {
		await handleBashCommand(parsedInput.bashCommand, options);
		return;
	}

	// Handle slash commands (prefixed with /)
	if (message.startsWith('/')) {
		await handleSlashCommand(message, options);
		return;
	}

	// Regular chat message - process with AI
	await options.onHandleChatMessage(message);
}

export function createClearMessagesHandler(
	setMessages: (messages: Message[]) => void,
	client: LLMClient | null,
) {
	return async () => {
		// Clear message history and client context
		setMessages([]);
		if (client) {
			await client.clearContext();
		}
	};
}
