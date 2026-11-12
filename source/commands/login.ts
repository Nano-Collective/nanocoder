import React from 'react';
import {CodexLogin} from '@/commands/codex-login';
import {CopilotLogin} from '@/commands/copilot-login';
import {errorMsg, infoMsg, successMsg} from '@/components/message-factory';
import {generateKey} from '@/session/key-generator';
import type {StatefulCommand} from '@/types/index';

const LOGIN_USAGE =
	'Usage: /login <codex|copilot> [provider name]\n\n  /login codex    Log in to ChatGPT/Codex (saves credentials for the "ChatGPT" provider)\n  /login copilot  Log in to GitHub Copilot (saves credentials for the "GitHub Copilot" provider)';

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
 * `/login codex|copilot [providerName]` (and the old `/codex-login` and
 * `/copilot-login`, which expand to it) runs the device flow as a live
 * component and completes when it finishes. Without a known target it shows
 * the usage.
 */
export const loginCommand: StatefulCommand = {
	name: 'login',
	description:
		'Log in to ChatGPT/Codex or GitHub Copilot with a device code (/login codex, /login copilot)',
	run: async context => {
		const trimmed = context.argText.trim();
		const args = trimmed ? trimmed.split(/\s+/) : [];
		const targetName = args[0]?.toLowerCase();
		if (targetName !== 'codex' && targetName !== 'copilot') {
			return {show: infoMsg(LOGIN_USAGE, 'login-usage')};
		}
		const target = LOGIN_TARGETS[targetName];
		const providerName =
			args.slice(1).join(' ').trim() || target.defaultProvider;

		context.setIsToolExecuting(true);

		const until = new Promise<void>(resolve => {
			context.setLiveComponent(
				React.createElement(target.component, {
					key: generateKey(`${target.keyPrefix}-live`),
					providerName,
					onDone: result => {
						context.setLiveComponent(null);
						context.setIsToolExecuting(false);

						if (result.success) {
							context.addToChatQueue(
								successMsg(
									`Logged in. Credentials saved for "${providerName}".`,
									`${target.keyPrefix}-done`,
								),
							);
						} else {
							context.addToChatQueue(
								errorMsg(
									result.error ?? 'Login failed.',
									`${target.keyPrefix}-error`,
								),
							);
						}

						resolve();
					},
				}),
			);
		});

		return {until};
	},
};
