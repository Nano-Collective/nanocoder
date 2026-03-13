import React from 'react';
import type {Command} from '@/types/index';

export const ideCommand: Command = {
	name: 'ide',
	description: 'Connect to an IDE',
	handler: (_args: string[], _messages, _metadata) => {
		// Handled specially in app-util.ts - enters IDE selection mode
		return Promise.resolve(React.createElement(React.Fragment));
	},
};
