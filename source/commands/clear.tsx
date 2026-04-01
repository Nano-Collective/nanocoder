import {Command} from '@/types/index';

/**
 * Clear command registration for /help display.
 * Actual handling is in app-util.ts handleSpecialCommand since it needs app state
 * (onClearMessages) to clear chat history and model context.
 */
export const clearCommand: Command = {
	name: 'clear',
	description: 'Clear the chat history, model context, and tasks',
	handler: async (_args: string[]) => {
		// Handled by handleSpecialCommand in app-util.ts
		return undefined;
	},
};
