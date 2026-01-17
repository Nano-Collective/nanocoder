import {Text} from 'ink';
import React from 'react';
import {Command} from '@/types/index';

// Note: The /setup-providers command is handled via app-util.ts which calls
// onEnterConfigWizardMode() directly, not through this command handler.
// This export exists for command registration only.
export const setupProvidersCommand: Command = {
	name: 'setup-providers',
	description: 'Launch interactive configuration wizard',
	handler: () => {
		// This handler is never called - the command is intercepted in app-util.ts
		// and handled via the mode system (onEnterConfigWizardMode)
		return Promise.resolve(React.createElement(Text, {}, ''));
	},
};
