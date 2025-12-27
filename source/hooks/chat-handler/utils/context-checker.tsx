import {WarningMessage} from '@/components/message-box';
import {
	TOKEN_THRESHOLD_CRITICAL_PERCENT,
	TOKEN_THRESHOLD_WARNING_PERCENT,
} from '@/constants';
import {getModelContextLimit} from '@/models/index';
import {createTokenizer} from '@/tokenization/index';
import type {Message} from '@/types/core';
import type {Tokenizer} from '@/types/tokenization';
import {calculateTokenBreakdown} from '@/usage/calculator';
import {getLogger} from '@/utils/logging';
import type React from 'react';

/**
 * Checks context usage and displays warning if approaching limit.
 * Shows different warnings based on TOKEN_THRESHOLD thresholds.
 *
 * @param allMessages - All messages to check token count for
 * @param systemMessage - System message to include in count
 * @param currentProvider - Current LLM provider name
 * @param currentModel - Current model name
 * @param addToChatQueue - Callback to add warning message to chat
 * @param getNextComponentKey - Function to generate unique React keys
 */
export const checkContextUsage = async (
	allMessages: Message[],
	systemMessage: Message,
	currentProvider: string,
	currentModel: string,
	addToChatQueue: (component: React.ReactNode) => void,
	getNextComponentKey: () => number,
): Promise<void> => {
	const logger = getLogger();

	// 1. Get context limit
	let contextLimit: number | null;
	try {
		contextLimit = await getModelContextLimit(currentModel);
	} catch (error) {
		logger.debug('Failed to get model context limit', {
			model: currentModel,
			error,
		});
		return;
	}
	if (!contextLimit) return;

	// 2. Create tokenizer
	let tokenizer: Tokenizer | undefined;
	try {
		tokenizer = createTokenizer(currentProvider, currentModel);
	} catch (error) {
		logger.debug('Failed to create tokenizer', {
			provider: currentProvider,
			model: currentModel,
			error,
		});
		return;
	}

	// 3. Calculate token breakdown and display warnings
	try {
		const breakdown = calculateTokenBreakdown(
			[systemMessage, ...allMessages],
			tokenizer,
		);

		const percentUsed = (breakdown.total / contextLimit) * 100;

		if (percentUsed >= TOKEN_THRESHOLD_CRITICAL_PERCENT) {
			addToChatQueue(
				<WarningMessage
					key={`context-warning-${getNextComponentKey()}`}
					message={`Context ${Math.round(
						percentUsed,
					)}% full (${breakdown.total.toLocaleString()}/${contextLimit.toLocaleString()} tokens). Consider using /clear to start fresh.`}
					hideBox={true}
				/>,
			);
		} else if (percentUsed >= TOKEN_THRESHOLD_WARNING_PERCENT) {
			addToChatQueue(
				<WarningMessage
					key={`context-warning-${getNextComponentKey()}`}
					message={`Context ${Math.round(
						percentUsed,
					)}% full (${breakdown.total.toLocaleString()}/${contextLimit.toLocaleString()} tokens).`}
					hideBox={true}
				/>,
			);
		}
	} catch (error) {
		logger.debug('Failed to calculate token breakdown', {error});
	} finally {
		if (tokenizer?.free) {
			tokenizer.free();
		}
	}
};
