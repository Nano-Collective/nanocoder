import React from 'react';
import type {Command} from '@/types/commands';

export const compactCommand: Command = {
	name: 'compact',
	description:
		'Compress message history to reduce context usage (use --aggressive, --conservative, --preview, --auto-on, --auto-off, --threshold <n>)',
	handler: async (_args: string[], _messages, _metadata) => {
		return Promise.resolve(React.createElement(React.Fragment));
	},
};
