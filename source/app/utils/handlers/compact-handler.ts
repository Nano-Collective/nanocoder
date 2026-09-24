import React from 'react';
import {InfoMessage, SuccessMessage} from '@/components/message-box';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import {getModelContextLimit, getSessionContextLimit} from '@/models/index';
import {runLifecycleHooks} from '@/services/lifecycle-hooks';
import {generateKey} from '@/session/key-generator';
import {createTokenizer} from '@/tokenization/index';
import type {
	AIProviderConfig,
	CompressionMode,
	CompressionStrategy,
} from '@/types/config';
import type {Message, MessageSubmissionOptions} from '@/types/index';
import {
	setAutoCompactEnabled,
	setAutoCompactStrategy,
	setAutoCompactThreshold,
} from '@/utils/auto-compact';
import {compressionBackup} from '@/utils/compression-backup';
import {formatError} from '@/utils/error-formatter';
import {
	formatInlineToken,
	isRecognizedOverrideKey,
	parseInlineOverrides,
} from '@/utils/inline-overrides';
import {summariseWithLLM} from '@/utils/llm-summariser';
import {
	COMPRESSION_CONSTANTS,
	compressMessages,
	isThresholdInRange,
} from '@/utils/message-compression';
import {errorMsg, infoMsg, successMsg} from '@/utils/message-factory';
import {getLastBuiltPrompt} from '@/utils/prompt-builder';

/**
 * Evaluate a once-scoped threshold gate against current usage. Returns the
 * usage percentage, or null when it cannot be evaluated (unknown tokenizer,
 * unresolvable limit) so the caller fails open to normal compaction.
 *
 * The token sum mirrors the compaction's own `originalTokenCount`
 * (system message included); the limit prefers the session override —
 * which already carries a `?context-max` once-value when one was given,
 * so the two overrides compose.
 */
async function checkOnceThresholdGate(
	deps: {
		provider: string;
		model: string;
		providerConfig?: AIProviderConfig | null;
	},
	messages: Message[],
): Promise<{usagePct: number} | null> {
	try {
		const tokenizer = createTokenizer(deps.provider, deps.model);
		try {
			const systemMessage: Message = {
				role: 'system',
				content: getLastBuiltPrompt(),
			};
			let totalTokens = 0;
			for (const msg of [systemMessage, ...messages]) {
				totalTokens += tokenizer.countTokens(msg);
			}
			let limit = getSessionContextLimit();
			if (limit === null) {
				try {
					limit =
						(await getModelContextLimit(deps.model, {
							providerConfig: deps.providerConfig ?? undefined,
						})) ?? null;
				} catch {
					return null;
				}
			}
			if (limit === null || limit <= 0) {
				return null;
			}
			return {usagePct: (totalTokens / limit) * 100};
		} finally {
			if (tokenizer.free) {
				tokenizer.free();
			}
		}
	} catch {
		return null;
	}
}

/**
 * Handles /compact command. Returns true if handled.
 *
 * `onceThreshold` carries the explicit once-scoped `?threshold=` value for
 * this invocation (see `getOnceThreshold`). Unlike the session-override
 * store — which cannot tell a once-override apart from a persisted
 * `/compact --threshold` setting — it is only set when the user typed the
 * override on this command, so the default unconditional behaviour stays
 * untouched for plain `/compact`.
 */
export async function handleCompactCommand(
	commandParts: string[],
	options: MessageSubmissionOptions,
	onceThreshold?: number,
): Promise<boolean> {
	const {
		onAddToChatQueue,
		onCommandComplete,
		messages,
		setMessages,
		provider,
		model,
		client,
		providerConfig,
		setIsToolExecuting,
	} = options;

	if (commandParts[0] !== 'compact') {
		return false;
	}

	// Defensive: the dispatcher already consumes recognised `?key=value`
	// tokens, but direct callers (and tests) may pass them through. Consume
	// recognised overrides here as well; preserve anything else verbatim so
	// it stays visible in args instead of being silently swallowed.
	const {args: positional, overrides} = parseInlineOverrides(
		commandParts.slice(1),
	);
	const args = [
		...positional,
		...overrides
			.filter(o => !isRecognizedOverrideKey(o.key))
			.map(formatInlineToken),
	];
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
			if (Number.isNaN(thresholdValue) || !isThresholdInRange(thresholdValue)) {
				onAddToChatQueue(
					errorMsg(
						`Threshold must be a number between ${COMPRESSION_CONSTANTS.MIN_THRESHOLD_PERCENT} and ${COMPRESSION_CONSTANTS.MAX_THRESHOLD_PERCENT}.`,
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

		// Once-scoped threshold gate (`/compact ?threshold=80`): skip the
		// manual compaction when current usage sits below the threshold,
		// mirroring the automatic path's gate in `performAutoCompact`. This
		// is what makes the override observable for the `/compact` run
		// itself. Best-effort — anything unresolvable fails open to the
		// normal unconditional compaction below.
		if (onceThreshold !== undefined) {
			const gate = await checkOnceThresholdGate(
				{
					provider,
					model,
					providerConfig: providerConfig ?? client?.getProviderConfig(),
				},
				messages,
			);
			if (gate && gate.usagePct < onceThreshold) {
				onAddToChatQueue(
					infoMsg(
						`Context at ${Math.round(gate.usagePct)}% — below the once-threshold of ${onceThreshold}% for this command; skipping compaction.`,
						'compact-once-threshold-skip',
					),
				);
				setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
				return true;
			}
		}

		// Same observe-only pre-compact hook the automatic path fires, so a
		// manual /compact isn't a blind spot for anything archiving context.
		await runLifecycleHooks('pre-compact', {messageCount: messages.length});

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
