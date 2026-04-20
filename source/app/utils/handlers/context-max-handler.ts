import React from 'react';
import {
	ErrorMessage,
	InfoMessage,
	SuccessMessage,
} from '@/components/message-box';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import {
	resetSessionContextLimit,
	resolveModelContextLimit,
	setSessionContextLimit,
} from '@/models/index';
import type {MessageSubmissionOptions} from '@/types/index';

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

/**
 * Handles /context-max command. Returns true if handled.
 */
export async function handleContextMaxCommand(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {
		onAddToChatQueue,
		onCommandComplete,
		getNextComponentKey,
		model,
		providerConfig,
	} = options;

	if (commandParts[0] !== 'context-max') {
		return false;
	}

	const args = commandParts.slice(1);

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

	const resolved = await resolveModelContextLimit(model, {
		providerConfig: providerConfig ?? undefined,
	});

	const sourceLabels = {
		session: 'session override',
		'provider-model-config': 'provider model config',
		'provider-config': 'provider config',
		env: 'NANOCODER_CONTEXT_LIMIT env',
		'model-lookup': 'model lookup',
		unknown: 'unknown',
	} as const;

	if (resolved.limit !== null) {
		onAddToChatQueue(
			React.createElement(InfoMessage, {
				key: `context-max-info-${getNextComponentKey()}`,
				message: `Context limit: ${resolved.limit.toLocaleString()} tokens (${sourceLabels[resolved.source]})`,
				hideBox: true,
				marginTop: 1,
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
