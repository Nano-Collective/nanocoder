import React from 'react';
import {InfoMessage, SuccessMessage} from '@/components/message-box';
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
import {errorMsg, infoMsg, successMsg} from '@/utils/message-factory';
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
					successMsg(
						`Restored ${restored.length} messages from backup.`,
						'compact-restore',
					),
				);
				compressionBackup.clearBackup();
			} else {
				onAddToChatQueue(
					errorMsg('No backup available to restore.', 'compact-restore-error'),
				);
			}
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		} else if (arg === '--auto-on') {
			setAutoCompactEnabled(true);
			onAddToChatQueue(
				successMsg('Auto-compact enabled for this session.', 'compact-auto-on'),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		} else if (arg === '--auto-off') {
			setAutoCompactEnabled(false);
			onAddToChatQueue(
				successMsg(
					'Auto-compact disabled for this session.',
					'compact-auto-off',
				),
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
					successMsg(
						`Auto-compact strategy set to ${next} for this session.`,
						'compact-strategy',
					),
				);
				setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
				return true;
			}
			onAddToChatQueue(
				errorMsg(
					'Strategy must be "llm" or "mechanical".',
					'compact-strategy-error',
				),
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
					errorMsg(
						'Threshold must be a number between 50 and 95.',
						'compact-threshold-error',
					),
				);
				setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
				return true;
			}
			setAutoCompactThreshold(Math.round(thresholdValue));
			onAddToChatQueue(
				successMsg(
					`Auto-compact threshold set to ${Math.round(thresholdValue)}% for this session.`,
					'compact-threshold',
				),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		}
	}

	try {
		if (messages.length === 0) {
			onAddToChatQueue(infoMsg('No messages to compact.', 'compact-info'));
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
				infoMsg(
					'Compacting context (LLM summary, may take a few seconds)...',
					'compact-progress',
				),
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
					infoMsg(
						'LLM summary unavailable - falling back to mechanical compaction.',
						'compact-fallback',
					),
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
					infoMsg(`Preview: ${summaryMessage}`, 'compact-preview'),
				);
			} else {
				compressionBackup.storeBackup(messages);
				setMessages(llmResult);
				onAddToChatQueue(successMsg(summaryMessage, 'compact-success'));
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
			errorMsg(
				`Failed to compact messages: ${formatError(error)}`,
				'compact-error',
			),
		);
		onCommandComplete?.();
		return true;
	}
}
