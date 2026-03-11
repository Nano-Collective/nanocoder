import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import React from 'react';
import {parseInput} from '@/command-parser';
import {commandRegistry} from '@/commands';
import {CopilotLogin} from '@/commands/copilot-login';
import BashProgress from '@/components/bash-progress';
import {
	ErrorMessage,
	InfoMessage,
	SuccessMessage,
} from '@/components/message-box';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import {
	getModelContextLimit,
	getSessionContextLimit,
	resetSessionContextLimit,
	setSessionContextLimit,
} from '@/models/index';
import {CheckpointManager} from '@/services/checkpoint-manager';
import {sessionManager} from '@/session/session-manager';
import {createTokenizer} from '@/tokenization/index';
import {executeBashCommand, formatBashResultForLLM} from '@/tools/execute-bash';
import type {CompressionMode} from '@/types/config';
import type {LLMClient} from '@/types/core';
import type {Message, MessageSubmissionOptions} from '@/types/index';
import {
	setAutoCompactEnabled,
	setAutoCompactThreshold,
} from '@/utils/auto-compact';
import {compressionBackup} from '@/utils/compression-backup';
import {compressMessages} from '@/utils/message-compression';
import {processPromptTemplate} from '@/utils/prompt-processor';

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
	SCHEDULE: 'schedule',
	COMMANDS: 'commands',
} as const;

/** Checkpoint subcommands */
const CHECKPOINT_SUBCOMMANDS = {
	LOAD: 'load',
	RESTORE: 'restore',
} as const;

/** Resume/session command names (including aliases) */
const RESUME_COMMANDS = ['resume', 'sessions', 'history'] as const;

function isResumeCommand(commandName: string): boolean {
	return RESUME_COMMANDS.includes(
		commandName.toLowerCase() as (typeof RESUME_COMMANDS)[number],
	);
}

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
			// Status adds to queue synchronously, give React time to render
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

		default:
			return false;
	}
}

/**
 * Handles /schedule start as a special case that enters scheduler mode.
 * Other /schedule subcommands go through the normal command registry.
 * Returns true if handled.
 */
async function handleScheduleStart(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	if (
		commandParts[0] !== SPECIAL_COMMANDS.SCHEDULE ||
		commandParts[1] !== 'start'
	) {
		return false;
	}

	const {onEnterSchedulerMode, onCommandComplete} = options;

	if (onEnterSchedulerMode) {
		onEnterSchedulerMode();
		onCommandComplete?.();
	} else {
		options.onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `schedule-error-${options.getNextComponentKey()}`,
				message: 'Scheduler mode is not available.',
			}),
		);
		onCommandComplete?.();
	}

	return true;
}

/**
 * Handles /schedule create — creates the schedule file and prompts the AI to help write it.
 * Returns true if handled.
 */
async function handleScheduleCreate(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	if (
		commandParts[0] !== SPECIAL_COMMANDS.SCHEDULE ||
		commandParts[1] !== 'create'
	) {
		return false;
	}

	const {
		onAddToChatQueue,
		onHandleChatMessage,
		onCommandComplete,
		getNextComponentKey,
	} = options;
	const fileName = commandParts[2];

	if (!fileName) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `schedule-create-error-${getNextComponentKey()}`,
				message:
					'Usage: /schedule create <name>\nExample: /schedule create deps-update',
			}),
		);
		onCommandComplete?.();
		return true;
	}

	const safeName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
	const schedulesDir = join(process.cwd(), '.nanocoder', 'schedules');
	const filePath = join(schedulesDir, safeName);

	if (existsSync(filePath)) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `schedule-create-exists-${getNextComponentKey()}`,
				message: `Schedule file already exists: .nanocoder/schedules/${safeName}`,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	mkdirSync(schedulesDir, {recursive: true});

	const template = `---
description: ${safeName.replace(/\.md$/, '')} scheduled command
---

`;

	writeFileSync(filePath, template, 'utf-8');

	onAddToChatQueue(
		React.createElement(SuccessMessage, {
			key: `schedule-created-${getNextComponentKey()}`,
			message: `Created schedule file: .nanocoder/schedules/${safeName}`,
			hideBox: true,
		}),
	);

	// Ask the AI to help write the schedule command content
	await onHandleChatMessage(
		`I just created a new schedule command file at .nanocoder/schedules/${safeName}. Help me write the content for this scheduled task. Ask me what I want this scheduled job to do, then write the markdown prompt into the file using the write_file tool. The file should contain a clear prompt that instructs the AI agent what to do when this schedule runs. Keep the YAML frontmatter at the top with the description field.`,
	);

	return true;
}

/**
 * Handles /commands create — creates the command file and prompts the AI to help write it.
 * Returns true if handled.
 */
async function handleCommandCreate(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	if (
		(commandParts[0] !== SPECIAL_COMMANDS.COMMANDS &&
			commandParts[0] !== 'custom-commands') ||
		commandParts[1] !== 'create'
	) {
		return false;
	}

	const {
		onAddToChatQueue,
		onHandleChatMessage,
		onCommandComplete,
		getNextComponentKey,
	} = options;
	const fileName = commandParts[2];

	if (!fileName) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `commands-create-error-${getNextComponentKey()}`,
				message:
					'Usage: /commands create <name>\nExample: /commands create review-code',
			}),
		);
		onCommandComplete?.();
		return true;
	}

	const safeName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
	const commandsDir = join(process.cwd(), '.nanocoder', 'commands');
	const filePath = join(commandsDir, safeName);

	if (existsSync(filePath)) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `commands-create-exists-${getNextComponentKey()}`,
				message: `Command file already exists: .nanocoder/commands/${safeName}`,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	mkdirSync(commandsDir, {recursive: true});

	const template = `---
description: ${safeName.replace(/\.md$/, '')} custom command
---

`;

	writeFileSync(filePath, template, 'utf-8');

	onAddToChatQueue(
		React.createElement(SuccessMessage, {
			key: `commands-created-${getNextComponentKey()}`,
			message: `Created command file: .nanocoder/commands/${safeName}`,
			hideBox: true,
		}),
	);

	// Ask the AI to help write the custom command content
	const commandBaseName = safeName.replace(/\.md$/, '');
	await onHandleChatMessage(
		`I just created a new custom command file at .nanocoder/commands/${safeName}. Help me write the content for this command. Ask me what I want this command to do, then write the markdown prompt into the file using the write_file tool. The file should contain a clear prompt that instructs the AI what to do when this command is invoked via /${commandBaseName}. Keep the YAML frontmatter at the top.

Here is an example of the frontmatter format with all available fields:

---
description: Generate unit tests for a file
aliases: [test, unittest]
parameters: [filename]
tags: [testing, quality]
triggers: [write tests, unit test]
estimated-tokens: 2000
resources: true
category: testing
version: 1.0.0
author: user
examples:
  - /gen-tests src/utils.ts
  - /gen-tests lib/parser.ts
references: [docs/testing-guide.md]
dependencies: [lint]
---
Generate comprehensive unit tests for {{filename}}...

All fields are optional except description. Use whichever fields are appropriate for the user's needs. Parameters defined here can be used as {{param}} placeholders in the prompt body.`,
	);

	return true;
}

// Handles compact command, Returns true if compact command was handled
async function handleCompactCommand(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {
		onAddToChatQueue,
		onCommandComplete,
		getNextComponentKey,
		messages,
		setMessages,
		provider,
		model,
	} = options;

	// Check if this is a compact command
	if (commandParts[0] !== 'compact') {
		return false;
	}

	// Parse arguments
	const args = commandParts.slice(1);
	let mode: CompressionMode = 'default';
	let preview = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--aggressive') {
			mode = 'aggressive';
		} else if (arg === '--conservative') {
			mode = 'conservative';
		} else if (arg === '--preview') {
			preview = true;
		} else if (arg === '--default') {
			mode = 'default';
		} else if (arg === '--restore') {
			// Restore messages from backup
			const restored = compressionBackup.restore();
			if (restored) {
				setMessages(restored);
				onAddToChatQueue(
					React.createElement(SuccessMessage, {
						key: `compact-restore-${getNextComponentKey()}`,
						message: `Restored ${restored.length} messages from backup.`,
						hideBox: true,
					}),
				);
				compressionBackup.clearBackup();
			} else {
				onAddToChatQueue(
					React.createElement(ErrorMessage, {
						key: `compact-restore-error-${getNextComponentKey()}`,
						message: 'No backup available to restore.',
						hideBox: true,
					}),
				);
			}
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		} else if (arg === '--auto-on') {
			// Enable auto-compact for current session
			setAutoCompactEnabled(true);
			onAddToChatQueue(
				React.createElement(SuccessMessage, {
					key: `compact-auto-on-${getNextComponentKey()}`,
					message: 'Auto-compact enabled for this session.',
					hideBox: true,
				}),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		} else if (arg === '--auto-off') {
			// Disable auto compact for current session
			setAutoCompactEnabled(false);
			onAddToChatQueue(
				React.createElement(SuccessMessage, {
					key: `compact-auto-off-${getNextComponentKey()}`,
					message: 'Auto-compact disabled for this session.',
					hideBox: true,
				}),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		} else if (arg === '--threshold' && i + 1 < args.length) {
			// Set threshold for current session
			const thresholdValue = Number.parseFloat(args[i + 1]);
			if (
				Number.isNaN(thresholdValue) ||
				thresholdValue < 50 ||
				thresholdValue > 95
			) {
				onAddToChatQueue(
					React.createElement(ErrorMessage, {
						key: `compact-threshold-error-${getNextComponentKey()}`,
						message: 'Threshold must be a number between 50 and 95.',
						hideBox: true,
					}),
				);
				setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
				return true;
			}
			setAutoCompactThreshold(Math.round(thresholdValue));
			onAddToChatQueue(
				React.createElement(SuccessMessage, {
					key: `compact-threshold-${getNextComponentKey()}`,
					message: `Auto-compact threshold set to ${Math.round(thresholdValue)}% for this session.`,
					hideBox: true,
				}),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		}
	}

	try {
		if (messages.length === 0) {
			onAddToChatQueue(
				React.createElement(InfoMessage, {
					key: `compact-info-${getNextComponentKey()}`,
					message: 'No messages to compact.',
					hideBox: true,
				}),
			);
			onCommandComplete?.();
			return true;
		}

		// Create tokenizer
		const tokenizer = createTokenizer(provider, model);

		// Include system message in token calculations for consistency with /status and auto-compact
		const systemPrompt = processPromptTemplate();
		const systemMessage: Message = {role: 'system', content: systemPrompt};
		const allMessages = [systemMessage, ...messages];

		// Perform compression (includes system message for accurate token counting)
		const result = compressMessages(allMessages, tokenizer, {mode});

		// Clean up tokenizer
		if (tokenizer.free) {
			tokenizer.free();
		}

		if (preview) {
			// Preview mode: show what would be compressed without applying
			const message = `Preview: Context would be compacted: ${result.originalTokenCount.toLocaleString()} tokens → ${result.compressedTokenCount.toLocaleString()} tokens (${Math.round(result.reductionPercentage)}% reduction)\n\nPreserved:\n• ${result.preservedInfo.keyDecisions} key decisions\n• ${result.preservedInfo.fileModifications} file modifications\n• ${result.preservedInfo.toolResults} tool results\n• ${result.preservedInfo.recentMessages} recent messages at full detail`;
			onAddToChatQueue(
				React.createElement(InfoMessage, {
					key: `compact-preview-${getNextComponentKey()}`,
					message,
					hideBox: false,
				}),
			);
		} else {
			// Apply compression and store backup before compression
			compressionBackup.storeBackup(messages);

			// Filter out system messages from compressed result (they're managed separately)
			const compressedUserMessages = result.compressedMessages.filter(
				msg => msg.role !== 'system',
			);
			setMessages(compressedUserMessages);

			// Show success message
			const message = `Context Compacted: ${result.originalTokenCount.toLocaleString()} tokens → ${result.compressedTokenCount.toLocaleString()} tokens (${Math.round(result.reductionPercentage)}% reduction)\n\nPreserved:\n• ${result.preservedInfo.keyDecisions} key decisions\n• ${result.preservedInfo.fileModifications} file modifications\n• ${result.preservedInfo.toolResults} tool results\n• ${result.preservedInfo.recentMessages} recent messages at full detail`;
			onAddToChatQueue(
				React.createElement(SuccessMessage, {
					key: `compact-success-${getNextComponentKey()}`,
					message,
					hideBox: false,
				}),
			);
		}

		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return true;
	} catch (error) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `compact-error-${getNextComponentKey()}`,
				message: `Failed to compact messages: ${getErrorMessage(error)}`,
				hideBox: true,
			}),
		);
		onCommandComplete?.();
		return true;
	}
}

/**
 * Parses a context limit value string, supporting k/K suffix.
 * e.g. "8192" -> 8192, "128k" -> 128000, "128K" -> 128000
 */
export function parseContextLimit(value: string): number | null {
	const trimmed = value.trim().toLowerCase();
	let multiplier = 1;
	let numStr = trimmed;

	if (trimmed.endsWith('k')) {
		multiplier = 1000;
		numStr = trimmed.slice(0, -1);
	}

	const parsed = Number.parseFloat(numStr);
	if (Number.isNaN(parsed) || parsed <= 0) {
		return null;
	}

	return Math.round(parsed * multiplier);
}

// Handles /context-max command. Returns true if handled.
async function handleContextMaxCommand(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {onAddToChatQueue, onCommandComplete, getNextComponentKey, model} =
		options;

	if (commandParts[0] !== 'context-max') {
		return false;
	}

	const args = commandParts.slice(1);

	// /context-max --reset — clear session override
	if (args[0] === '--reset') {
		resetSessionContextLimit();
		onAddToChatQueue(
			React.createElement(SuccessMessage, {
				key: `context-max-reset-${getNextComponentKey()}`,
				message: 'Session context limit override cleared.',
				hideBox: true,
			}),
		);
		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return true;
	}

	// /context-max <number> — set session context limit
	if (args.length > 0) {
		const limit = parseContextLimit(args[0]);
		if (limit === null) {
			onAddToChatQueue(
				React.createElement(ErrorMessage, {
					key: `context-max-error-${getNextComponentKey()}`,
					message:
						'Invalid context limit. Use a positive number, e.g. /context-max 8192 or /context-max 128k',
				}),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		}

		setSessionContextLimit(limit);
		onAddToChatQueue(
			React.createElement(SuccessMessage, {
				key: `context-max-set-${getNextComponentKey()}`,
				message: `Session context limit set to ${limit.toLocaleString()} tokens.`,
				hideBox: true,
			}),
		);
		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return true;
	}

	// /context-max (no args) — show current effective context limit
	const sessionLimit = getSessionContextLimit();
	if (sessionLimit !== null) {
		onAddToChatQueue(
			React.createElement(InfoMessage, {
				key: `context-max-info-${getNextComponentKey()}`,
				message: `Context limit: ${sessionLimit.toLocaleString()} tokens (session override)`,
				hideBox: true,
			}),
		);
		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return true;
	}

	const envLimit = process.env.NANOCODER_CONTEXT_LIMIT;
	if (envLimit) {
		const parsed = Number.parseInt(envLimit, 10);
		if (!Number.isNaN(parsed) && parsed > 0) {
			onAddToChatQueue(
				React.createElement(InfoMessage, {
					key: `context-max-info-${getNextComponentKey()}`,
					message: `Context limit: ${parsed.toLocaleString()} tokens (NANOCODER_CONTEXT_LIMIT env)`,
					hideBox: true,
				}),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		}
	}

	const modelLimit = await getModelContextLimit(model);
	if (modelLimit !== null) {
		onAddToChatQueue(
			React.createElement(InfoMessage, {
				key: `context-max-info-${getNextComponentKey()}`,
				message: `Context limit: ${modelLimit.toLocaleString()} tokens (model lookup)`,
				hideBox: true,
			}),
		);
	} else {
		onAddToChatQueue(
			React.createElement(InfoMessage, {
				key: `context-max-info-${getNextComponentKey()}`,
				message:
					'Context limit: Unknown. Use /context-max <number> to set one.',
				hideBox: true,
			}),
		);
	}
	setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
	return true;
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
 * Handles /resume, /sessions, /history (session resume).
 * No args: show session selector. One arg: resume by "last", id, or list index.
 * Returns true if handled.
 */
async function handleResumeCommand(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const commandName = commandParts[0]?.toLowerCase();
	if (!commandName || !isResumeCommand(commandName)) {
		return false;
	}

	const {
		onAddToChatQueue,
		onEnterSessionSelectorMode,
		onResumeSession,
		onCommandComplete,
		getNextComponentKey,
	} = options;

	if (!onEnterSessionSelectorMode || !onResumeSession) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `resume-error-${getNextComponentKey()}`,
				message: 'Session management is not available in this context.',
				hideBox: true,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	const rawArgs = commandParts.slice(1);
	const showAll = rawArgs.includes('--all');
	const args = rawArgs.filter(a => a !== '--all');

	try {
		await sessionManager.initialize();
	} catch (error) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `resume-error-${getNextComponentKey()}`,
				message: `Failed to initialize sessions: ${getErrorMessage(error)}`,
				hideBox: true,
			}),
		);
		onCommandComplete?.();
		return true;
	}

	// No args: show session selector
	if (args.length === 0) {
		onEnterSessionSelectorMode(showAll || undefined);
		onCommandComplete?.();
		return true;
	}

	// One arg: resolve and load session
	const sessionIdOrSpecial = args[0];
	try {
		const listOptions = showAll ? undefined : {workingDirectory: process.cwd()};
		const sessions = await sessionManager.listSessions(listOptions);
		const sorted = [...sessions].sort(
			(a, b) =>
				new Date(b.lastAccessedAt).getTime() -
				new Date(a.lastAccessedAt).getTime(),
		);

		let sessionId: string | null = null;

		if (sessionIdOrSpecial.toLowerCase() === 'last') {
			if (sorted.length > 0) sessionId = sorted[0].id;
		} else {
			const index = Number.parseInt(sessionIdOrSpecial, 10);
			if (!Number.isNaN(index) && index >= 1 && index <= sorted.length) {
				sessionId = sorted[index - 1].id;
			} else {
				sessionId = sessionIdOrSpecial;
			}
		}

		if (!sessionId) {
			onAddToChatQueue(
				React.createElement(InfoMessage, {
					key: `resume-info-${getNextComponentKey()}`,
					message: 'No sessions found.',
					hideBox: true,
				}),
			);
			onCommandComplete?.();
			return true;
		}

		const session = await sessionManager.loadSession(sessionId);
		if (session) {
			onResumeSession(session);
		} else {
			onAddToChatQueue(
				React.createElement(ErrorMessage, {
					key: `resume-error-${getNextComponentKey()}`,
					message: `Session not found: ${sessionId}`,
					hideBox: true,
				}),
			);
		}
	} catch (error) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: `resume-error-${getNextComponentKey()}`,
				message: `Failed to resume session: ${getErrorMessage(error)}`,
				hideBox: true,
			}),
		);
	}

	onCommandComplete?.();
	return true;
}

/**
 * Handles /copilot-login as a live component so spinners animate and state updates render.
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
							message: `Logged in. Credential saved for "${providerName}".`,
							hideBox: true,
						}),
					);
				} else {
					onAddToChatQueue(
						React.createElement(ErrorMessage, {
							key: `copilot-login-error-${getNextComponentKey()}`,
							message: result.error ?? 'Login failed.',
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

	// Try compact command
	const commandParts = message.slice(1).trim().split(/\s+/);
	if (await handleCompactCommand(commandParts, options)) {
		return;
	}

	// Try context-max command
	if (await handleContextMaxCommand(commandParts, options)) {
		return;
	}

	// Try /schedule start (enters scheduler mode)
	if (await handleScheduleStart(commandParts, options)) {
		return;
	}

	// Try /schedule create (creates file + AI assistance)
	if (await handleScheduleCreate(commandParts, options)) {
		return;
	}

	// Try /commands create (creates file + AI assistance)
	if (await handleCommandCreate(commandParts, options)) {
		return;
	}

	// Try special command
	if (await handleSpecialCommand(commandName, options)) {
		return;
	}

	// Try checkpoint load
	if (await handleCheckpointLoad(commandParts, options)) {
		return;
	}

	// Try /resume, /sessions, /history
	if (await handleResumeCommand(commandParts, options)) {
		return;
	}

	// Try /copilot-login (uses live component for animated spinners)
	if (handleCopilotLogin(commandParts, options)) {
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
