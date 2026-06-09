import {Command} from '@/types/index';

/**
 * Rename session command registration for /help display.
 * Actual handling is in app-util.ts handleSpecialCommand since it needs app state
 * (setSessionName) to update the session name.
 */
export const renameCommand: Command = {
	name: 'rename',
	description: 'Rename the current session (/rename <new name>)',
	handler: async (_args: string[]) => {
		// Handled by handleSpecialCommand in app-util.ts
		return undefined;
	},
};
