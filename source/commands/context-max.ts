import React from 'react';
import {InfoMessage} from '@/components/message-box';
import {errorMsg, infoMsg, successMsg} from '@/components/message-factory';
import {
	resetSessionContextLimit,
	resolveModelContextLimit,
	setSessionContextLimit,
} from '@/models/index';
import {generateKey} from '@/session/key-generator';
import type {StatefulCommand} from '@/types/index';
import {parseContextLimit} from '@/utils/parse-context-limit';

/**
 * /context-max sets the maximum context length for the current session.
 *
 * /context-max <number>   - Set context limit (supports k/K suffix, e.g. 128k)
 * /context-max            - Show current effective context limit
 * /context-max --reset    - Clear session override
 */
export const contextMaxCommand: StatefulCommand = {
	name: 'context-max',
	description:
		'Set maximum context length for this session (e.g. /context-max 128k, --reset to clear)',
	run: async context => {
		const {addToChatQueue: onAddToChatQueue, model, providerConfig} = context;
		const trimmed = context.argText.trim();
		const args = trimmed ? trimmed.split(/\s+/) : [];

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
				onAddToChatQueue(
					errorMsg(
						'Invalid context limit. Use a positive number, e.g. /context-max 8192 or /context-max 128k',
						'context-max-error',
					),
				);
				return 'done-after-render';
			}

			setSessionContextLimit(limit);
			onAddToChatQueue(
				successMsg(
					`Session context limit set to ${limit.toLocaleString()} tokens.`,
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
					'Context limit: Unknown. Use /context-max <number> to set one.',
					'context-max-info',
				),
			);
		}
		return 'done-after-render';
	},
};
