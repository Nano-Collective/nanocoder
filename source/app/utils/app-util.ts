import React from 'react';
import {parseInput} from '@/command-parser';
import BashProgress from '@/components/bash-progress';
import {errorMsg} from '@/components/message-factory';
import {clearExpandableToolResults} from '@/components/tool-result-display';
import {BASH_OUTPUT_PREFIX} from '@/constants';
import {clearPendingHookContext} from '@/services/lifecycle-hooks';
import {generateKey} from '@/session/key-generator';
import {
	distillBashResultForLLM,
	executeBashCommand,
} from '@/tools/execute-bash';
import type {ImageAttachment, LLMClient} from '@/types/core';
import type {Message, MessageSubmissionOptions} from '@/types/index';
import {formatError} from '@/utils/error-formatter';
import {clearReadTracker} from '@/utils/read-tracker';
import {dispatchSlashCommand} from './command-dispatcher';

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
				showOutput: true,
			}),
		);

		// No re-run here: the user typed this command, so nothing else is run
		// on their behalf.
		const llmContext = await distillBashResultForLLM(result);

		if (llmContext) {
			const userMessage: Message = {
				role: 'user',
				content: `${BASH_OUTPUT_PREFIX}\n\`\`\`\n$ ${bashCommand}\n${llmContext}\n\`\`\``,
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

	// Trimmed, to agree with parseInput above: `  /help` is a slash command
	// there, so dispatching on the raw string sent it to the model as chat
	// instead. dispatchSlashCommand slices from the leading `/`, so it needs the
	// trimmed form rather than the original.
	const trimmed = message.trim();
	if (trimmed.startsWith('/')) {
		await dispatchSlashCommand(trimmed, options);
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
		// Expandable tool results point into the transcript being cleared.
		clearExpandableToolResults();
		// Undelivered session-start hook context belongs to the cleared
		// conversation — don't graft it onto the next one.
		clearPendingHookContext();
		if (client) {
			await client.clearContext();
		}
	};
}
