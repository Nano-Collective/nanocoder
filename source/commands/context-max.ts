import React from 'react';
import type {Command} from '@/types/commands';

/**
 * The /context-max command sets the maximum context length for the current session.
 *
 * Note: The actual command logic is handled in app-util.ts handleContextMaxCommand()
 * because it requires access to app state that isn't available through the standard
 * command handler interface.
 *
 * Usage:
 * /context-max <number>   - Set context limit (supports k/K suffix, e.g. 128k)
 * /context-max             - Show current effective context limit
 * /context-max --reset     - Clear session override
 */
export const contextMaxCommand: Command = {
	name: 'context-max',
	description:
		'Set maximum context length for this session (e.g. /context-max 128k, --reset to clear)',
	handler: async (_args: string[], _messages, _metadata) => {
		// Handler returns empty fragment - actual logic in app-util.ts handleContextMaxCommand()
		return Promise.resolve(React.createElement(React.Fragment));
	},
};
