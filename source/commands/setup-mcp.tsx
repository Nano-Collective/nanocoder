import {Text} from 'ink';
import React from 'react';
import {Command} from '@/types/index';

// Note: The /setup-mcp command is handled via app-util.ts which calls
// onEnterMcpWizardMode() directly, not through this command handler.
// This export exists for command registration only.
export const setupMcpCommand: Command = {
	name: 'setup-mcp',
	description: 'Launch interactive MCP server configuration wizard',
	handler: () => {
		// This handler is never called - the command is intercepted in app-util.ts
		// and handled via the mode system (onEnterMcpWizardMode)
		return Promise.resolve(React.createElement(Text, {}, ''));
	},
};
