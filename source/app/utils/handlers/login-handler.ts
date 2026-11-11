import React from 'react';
import {CodexLogin} from '@/commands/codex-login';
import {CopilotLogin} from '@/commands/copilot-login';
import {generateKey} from '@/session/key-generator';
import type {MessageSubmissionOptions} from '@/types/index';
import {errorMsg, successMsg} from '@/utils/message-factory';

/** Device-flow login targets for `/login <target> [providerName]`. */
const LOGIN_TARGETS = {
	codex: {
		component: CodexLogin,
		defaultProvider: 'ChatGPT',
		keyPrefix: 'codex-login',
	},
	copilot: {
		component: CopilotLogin,
		defaultProvider: 'GitHub Copilot',
		keyPrefix: 'copilot-login',
	},
} as const;

/**
 * Handles `/login codex|copilot [providerName]` (and the old `/codex-login`
 * and `/copilot-login`, which expand to it) as a live component. Returns true
 * if handled; `/login` without a known target falls through to the command's
 * usage message.
 */
export function handleLoginCommand(
	commandParts: string[],
	options: MessageSubmissionOptions,
): boolean {
	if (commandParts[0] !== 'login') {
		return false;
	}
	const targetName = commandParts[1]?.toLowerCase();
	if (targetName !== 'codex' && targetName !== 'copilot') {
		return false;
	}
	const target = LOGIN_TARGETS[targetName];

	const {
		setLiveComponent,
		setIsToolExecuting,
		onAddToChatQueue,
		onCommandComplete,
	} = options;

	const providerName =
		commandParts.slice(2).join(' ').trim() || target.defaultProvider;

	setIsToolExecuting(true);

	setLiveComponent(
		React.createElement(target.component, {
			key: generateKey(`${target.keyPrefix}-live`),
			providerName,
			onDone: result => {
				setLiveComponent(null);
				setIsToolExecuting(false);

				if (result.success) {
					onAddToChatQueue(
						successMsg(
							`Logged in. Credentials saved for "${providerName}".`,
							`${target.keyPrefix}-done`,
						),
					);
				} else {
					onAddToChatQueue(
						errorMsg(
							result.error ?? 'Login failed.',
							`${target.keyPrefix}-error`,
						),
					);
				}

				onCommandComplete?.();
			},
		}),
	);

	return true;
}
