import React from 'react';
import type {Command} from '@/types/index';

export const settingsCommand: Command = {
	name: 'settings',
	description: 'Configure UI settings (theme, shapes, branding)',
	handler: (_args: string[], _messages, _metadata) => {
		// This command is handled specially in app.tsx
		// This handler exists only for registration purposes
		return Promise.resolve(React.createElement(React.Fragment));
	},
};
