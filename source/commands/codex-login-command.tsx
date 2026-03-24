import type {Command} from '@/types/index';

export const codexLoginCommand: Command = {
	name: 'codex-login',
	description:
		'Log in to ChatGPT/Codex (device flow). Saves credentials for the "ChatGPT" provider.',
	handler: async () => {
		// Handled via setLiveComponent in app-util.ts for animated UI.
		// This handler is kept for command registry listing / help text.
	},
};
