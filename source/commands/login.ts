import type {Command} from '@/types/index';
import {infoMsg} from '@/utils/message-factory';

export const LOGIN_USAGE =
	'Usage: /login <codex|copilot> [provider name]\n\n  /login codex    Log in to ChatGPT/Codex (saves credentials for the "ChatGPT" provider)\n  /login copilot  Log in to GitHub Copilot (saves credentials for the "GitHub Copilot" provider)';

export const loginCommand: Command = {
	name: 'login',
	description:
		'Log in to ChatGPT/Codex or GitHub Copilot with a device code (/login codex, /login copilot)',
	handler: async () => {
		// `/login codex|copilot` is intercepted by the command dispatcher and rendered as a
		// live device-flow component. Reaching this handler means the target
		// was missing or unknown.
		return infoMsg(LOGIN_USAGE, 'login-usage');
	},
};
