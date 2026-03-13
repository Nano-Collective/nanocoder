import React from 'react';
import type {Command} from '@/types/index';

export const explorerCommand: Command = {
	name: 'explorer',
	description: 'Browse project files and add to context',
	handler: (_args: string[], _messages, _metadata) => {
		// Handled specially in app-util.ts - enters explorer mode
		return Promise.resolve(React.createElement(React.Fragment));
	},
};
