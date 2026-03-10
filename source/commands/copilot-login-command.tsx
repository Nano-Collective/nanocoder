import type {Command} from '@/types/index';

export const copilotLoginCommand: Command = {
	name: 'copilot-login',
	description:
		'Log in to GitHub Copilot (device flow). Saves credentials for the "GitHub Copilot" provider.',
	handler: async () => {
		// Handled via setLiveComponent in app-util.ts for animated UI.
		// This handler is kept for command registry listing / help text.
	},
};
