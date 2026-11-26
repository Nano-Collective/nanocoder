import React from 'react';
import {InfoMessage} from '@/components/message-box';
import {errorMsg, infoMsg, successMsg} from '@/components/message-factory';
import {
	resetSessionContextLimit,
	resolveModelContextLimit,
	setSessionContextLimit,
} from '@/models/index';
import type {StatefulCommand} from '@/types/index';
import {generateKey} from '@/utils/key-generator';
import {parseContextLimit} from '@/utils/parse-context-limit';

const INVALID_LIMIT_MESSAGE =
	'Invalid context limit. Use a positive number, e.g. /context-max 8192, /context-max 128k, or /context-max 1m';

const TOO_MANY_ARGUMENTS_MESSAGE =
	'Too many arguments. Usage: /context-max <limit> | --reset';

/**
 * /context-max sets the maximum context length for the current session.
 *
 * /context-max <number>   - Set context limit (supports positive integer or decimal values, k/K and m/M suffixes)
 * /context-max            - Show current effective context limit
 * /context-max --reset    - Clear session override
 *
 * Extra arguments are rejected with a usage error and change nothing.
 */
export const contextMaxCommand: StatefulCommand = {
	name: 'context-max',
	description:
		'Set maximum context length for this session (e.g. /context-max 128k or /context-max 1m, --reset to clear)',
	run: async context => {
		const {
			addToChatQueue: onAddToChatQueue,
			model,
			provider,
			providerConfig,
		} = context;
		const trimmed = context.argText.trim();
		const args = trimmed ? trimmed.split(/\s+/) : [];

		if (args.length > 1) {
			onAddToChatQueue(
				errorMsg(TOO_MANY_ARGUMENTS_MESSAGE, 'context-max-error'),
			);
			return 'done-after-render';
		}

		if (args[0] === '--reset') {
			resetSessionContextLimit();
			onAddToChatQueue(
				successMsg(
					'Session context limit override cleared.',
					'context-max-reset',
				),
			);
			return 'done-after-render';
		}

		if (args.length > 0) {
			const limit = parseContextLimit(args[0]);
			if (limit === null) {
				onAddToChatQueue(errorMsg(INVALID_LIMIT_MESSAGE, 'context-max-error'));
				return 'done-after-render';
			}

			setSessionContextLimit(limit, {provider, model});
			onAddToChatQueue(
				successMsg(
					`Session context limit set to ${limit.toLocaleString()} tokens for ${model}. It does not apply to other models or providers.`,
					'context-max-set',
				),
			);
			return 'done-after-render';
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
					key: generateKey('context-max-info'),
					message: `Context limit: ${resolved.limit.toLocaleString()} tokens (${sourceLabels[resolved.source]})`,
					hideBox: true,
					marginTop: 1,
				}),
			);
		} else {
			onAddToChatQueue(
				infoMsg(
					'Context limit: Unknown. Use /context-max <number>[k|m] to set one.',
					'context-max-info',
				),
			);
		}
		return 'done-after-render';
	},
};
