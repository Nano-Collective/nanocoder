import {Text} from 'ink';
import React from 'react';
import {Command} from '@/types/index';

/**
 * `/setup-providers` is a "special command": registered here for slash-menu
 * discovery and `/help` text, but actually dispatched in
 * `source/app/utils/app-util.ts` (see `SPECIAL_COMMANDS.SETUP_PROVIDERS`),
 * which calls `onEnterConfigWizardMode()` to swap the chat UI for the wizard.
 *
 * The handler is unreachable; it returns an empty Text so the Command type's
 * required handler shape is satisfied.
 */
export const setupProvidersCommand: Command = {
	name: 'setup-providers',
	description:
		'[deprecated — use /settings → Providers] Launch interactive configuration wizard',
	handler: () => {
		// This handler is never called - the command is intercepted in app-util.ts
		// and handled via the mode system (onEnterConfigWizardMode)
		return Promise.resolve(React.createElement(Text, {}, ''));
	},
};
