import React from 'react';
import {
	ErrorMessage,
	InfoMessage,
	SuccessMessage,
} from '@/components/message-box';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import {createTokenizer} from '@/tokenization/index';
import type {CompressionMode} from '@/types/config';
import type {Message, MessageSubmissionOptions} from '@/types/index';
import {
	setAutoCompactEnabled,
	setAutoCompactThreshold,
} from '@/utils/auto-compact';
import {compressionBackup} from '@/utils/compression-backup';
import {compressMessages} from '@/utils/message-compression';
import {getLastBuiltPrompt} from '@/utils/prompt-builder';

/**
 * Handles /compact command. Returns true if handled.
 */
export async function handleCompactCommand(
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

	if (commandParts[0] !== 'compact') {
		return false;
	}

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

		const tokenizer = createTokenizer(provider, model);
		const systemPrompt = getLastBuiltPrompt();
		const systemMessage: Message = {role: 'system', content: systemPrompt};
		const allMessages = [systemMessage, ...messages];
		const result = compressMessages(allMessages, tokenizer, {mode});

		if (tokenizer.free) {
			tokenizer.free();
		}

		if (preview) {
			const message = `Preview: Context would be compacted: ${result.originalTokenCount.toLocaleString()} tokens → ${result.compressedTokenCount.toLocaleString()} tokens (${Math.round(result.reductionPercentage)}% reduction)\n\nPreserved:\n• ${result.preservedInfo.keyDecisions} key decisions\n• ${result.preservedInfo.fileModifications} file modifications\n• ${result.preservedInfo.toolResults} tool results\n• ${result.preservedInfo.recentMessages} recent messages at full detail`;
			onAddToChatQueue(
				React.createElement(InfoMessage, {
					key: `compact-preview-${getNextComponentKey()}`,
					message,
					hideBox: false,
				}),
			);
		} else {
			compressionBackup.storeBackup(messages);
			const compressedUserMessages = result.compressedMessages.filter(
				msg => msg.role !== 'system',
			);
			setMessages(compressedUserMessages);

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
				message: `Failed to compact messages: ${error instanceof Error ? error.message : 'Unknown error'}`,
				hideBox: true,
			}),
		);
		onCommandComplete?.();
		return true;
	}
}
