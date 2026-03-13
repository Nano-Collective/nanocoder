import React from 'react';
import type {Command} from '@/types/commands';

/**
 * The /compact command compresses message history to reduce context usage.
 *
 * Note: The actual command logic is handled in app-util.ts handleCompactCommand()
 * because it requires access to app state (messages, setMessages, provider, model)
 * that isn't available through the standard command handler interface.
 *
 * This command definition exists to:
 * 1. Register the command in the command registry for /help and autocomplete
 * 2. Provide the command description to users
 *
 * Available flags:
 * --aggressive    - Aggressive compression mode (removes more content)
 * --conservative  - Conservative compression mode (preserves more content)
 * --default       - Default balanced compression mode
 * --preview       - Show compression preview without applying
 * --restore       - Restore messages from pre-compression backup
 * --auto-on       - Enable auto-compact for this session
 * --auto-off      - Disable auto-compact for this session
 * --threshold <n> - Set auto-compact threshold (50-95%) for this session
 */
export const compactCommand: Command = {
	name: 'compact',
	description:
		'Compress message history to reduce context usage (use --aggressive, --conservative, --preview, --restore, --auto-on, --auto-off, --threshold <n>)',
	handler: async (_args: string[], _messages, _metadata) => {
		// Handler returns empty fragment - actual logic in app-util.ts handleCompactCommand()
		return Promise.resolve(React.createElement(React.Fragment));
	},
};
