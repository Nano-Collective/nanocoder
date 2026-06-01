import React from 'react';
import {
	ErrorMessage,
	InfoMessage,
	SuccessMessage,
} from '@/components/message-box';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import {generateKey} from '@/session/key-generator';
import {createTokenizer} from '@/tokenization/index';
import type {CompressionMode, CompressionStrategy} from '@/types/config';
import type {Message, MessageSubmissionOptions} from '@/types/index';
import {
	setAutoCompactEnabled,
	setAutoCompactStrategy,
	setAutoCompactThreshold,
} from '@/utils/auto-compact';
import {compressionBackup} from '@/utils/compression-backup';
import {formatError} from '@/utils/error-formatter';
import {summariseWithLLM} from '@/utils/llm-summariser';
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
		messages,
		setMessages,
		provider,
		model,
		client,
		setIsToolExecuting,
	} = options;

	if (commandParts[0] !== 'compact') {
		return false;
	}

	const args = commandParts.slice(1);
	let mode: CompressionMode = 'default';
	let preview = false;
	// Strategy: explicit flag wins; otherwise prefer LLM when a client is available.
	let strategy: CompressionStrategy | null = null;

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
						key: generateKey('compact-restore'),
						message: `Restored ${restored.length} messages from backup.`,
						hideBox: true,
					}),
				);
				compressionBackup.clearBackup();
			} else {
				onAddToChatQueue(
					React.createElement(ErrorMessage, {
						key: generateKey('compact-restore-error'),
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
					key: generateKey('compact-auto-on'),
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
					key: generateKey('compact-auto-off'),
					message: 'Auto-compact disabled for this session.',
					hideBox: true,
				}),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		} else if (arg === '--llm') {
			strategy = 'llm';
		} else if (arg === '--mechanical') {
			strategy = 'mechanical';
		} else if (arg === '--strategy' && i + 1 < args.length) {
			const next = args[i + 1];
			if (next === 'llm' || next === 'mechanical') {
				setAutoCompactStrategy(next);
				onAddToChatQueue(
					React.createElement(SuccessMessage, {
						key: generateKey('compact-strategy'),
						message: `Auto-compact strategy set to ${next} for this session.`,
						hideBox: true,
					}),
				);
				setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
				return true;
			}
			onAddToChatQueue(
				React.createElement(ErrorMessage, {
					key: generateKey('compact-strategy-error'),
					message: 'Strategy must be "llm" or "mechanical".',
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
						key: generateKey('compact-threshold-error'),
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
					key: generateKey('compact-threshold'),
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
					key: generateKey('compact-info'),
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

		// Resolve strategy: explicit flag > LLM default when a client is available > mechanical.
		const effectiveStrategy: CompressionStrategy =
			strategy ?? (client ? 'llm' : 'mechanical');

		const originalTokenCount = allMessages.reduce(
			(sum, msg) => sum + tokenizer.countTokens(msg),
			0,
		);

		let llmResult: Message[] | null = null;
		if (effectiveStrategy === 'llm' && client) {
			// Lock input during the LLM round-trip so the user can't submit a
			// new message while compaction is mid-flight, and emit a status
			// message in the chat so the user knows it landed.
			onAddToChatQueue(
				React.createElement(InfoMessage, {
					key: generateKey('compact-progress'),
					message:
						'Compacting context (LLM summary, may take a few seconds)...',
					hideBox: true,
				}),
			);
			setIsToolExecuting?.(true);
			try {
				llmResult = await summariseWithLLM({
					messages,
					systemMessage,
					client,
					tokenizer,
				});
			} finally {
				setIsToolExecuting?.(false);
			}

			if (!llmResult) {
				// LLM either failed, returned empty, or produced a summary larger
				// than the source. Tell the user why we are about to fall back.
				onAddToChatQueue(
					React.createElement(InfoMessage, {
						key: generateKey('compact-fallback'),
						message:
							'LLM summary unavailable - falling back to mechanical compaction.',
						hideBox: true,
					}),
				);
			}
		}

		if (llmResult) {
			const compressedTokenCount = [systemMessage, ...llmResult].reduce(
				(sum, msg) => sum + tokenizer.countTokens(msg),
				0,
			);
			const reductionPercentage =
				originalTokenCount > 0
					? ((originalTokenCount - compressedTokenCount) / originalTokenCount) *
						100
					: 0;

			if (tokenizer.free) tokenizer.free();

			const summaryMessage = `Context Compacted (LLM summary): ${originalTokenCount.toLocaleString()} tokens → ${compressedTokenCount.toLocaleString()} tokens (${Math.round(reductionPercentage)}% reduction)`;

			if (preview) {
				onAddToChatQueue(
					React.createElement(InfoMessage, {
						key: generateKey('compact-preview'),
						message: `Preview: ${summaryMessage}`,
						hideBox: true,
					}),
				);
			} else {
				compressionBackup.storeBackup(messages);
				setMessages(llmResult);
				onAddToChatQueue(
					React.createElement(SuccessMessage, {
						key: generateKey('compact-success'),
						message: summaryMessage,
						hideBox: true,
					}),
				);
			}
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		}

		// Mechanical path (also covers LLM failure / no client)
		const result = compressMessages(allMessages, tokenizer, {mode});

		if (tokenizer.free) {
			tokenizer.free();
		}

		const stats = `${result.preservedInfo.fileModifications} file modifications, ${result.preservedInfo.toolResults} tool results, ${result.preservedInfo.recentMessages} recent messages kept at full detail`;

		if (preview) {
			const message = `Preview: Context would be compacted: ${result.originalTokenCount.toLocaleString()} tokens → ${result.compressedTokenCount.toLocaleString()} tokens (${Math.round(result.reductionPercentage)}% reduction)\n\nPreserved: ${stats}`;
			onAddToChatQueue(
				React.createElement(InfoMessage, {
					key: generateKey('compact-preview'),
					message,
					hideBox: true,
				}),
			);
		} else {
			compressionBackup.storeBackup(messages);
			const compressedUserMessages = result.compressedMessages.filter(
				msg => msg.role !== 'system',
			);
			setMessages(compressedUserMessages);

			const message = `Context Compacted: ${result.originalTokenCount.toLocaleString()} tokens → ${result.compressedTokenCount.toLocaleString()} tokens (${Math.round(result.reductionPercentage)}% reduction)\n\nPreserved: ${stats}`;
			onAddToChatQueue(
				React.createElement(SuccessMessage, {
					key: generateKey('compact-success'),
					message,
					hideBox: true,
				}),
			);
		}

		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return true;
	} catch (error) {
		onAddToChatQueue(
			React.createElement(ErrorMessage, {
				key: generateKey('compact-error'),
				message: `Failed to compact messages: ${formatError(error)}`,
				hideBox: true,
			}),
		);
		onCommandComplete?.();
		return true;
	}
}
