import React from 'react';
import {InfoMessage} from '@/components/message-box';
import {Command} from '@/types/index';
import {getShutdownManager} from '@/utils/shutdown';

export const exitCommand: Command = {
	name: 'exit',
	description: 'Exit the application',
	handler: (_args: string[], _messages, _metadata) => {
		// Return InfoMessage component first, then trigger graceful shutdown
		void getShutdownManager().gracefulShutdown(0);

		return Promise.resolve(
			React.createElement(InfoMessage, {
				message: 'Goodbye! 👋',
				hideTitle: true,
			}),
		);
	},
};

export const quitCommand: Command = {
	name: 'quit',
	description: 'Quit the application',
	handler: (_args: string[], _messages, _metadata) => {
		// Return InfoMessage component first, then trigger graceful shutdown
		void getShutdownManager().gracefulShutdown(0);

		return Promise.resolve(
			React.createElement(InfoMessage, {
				message: 'Goodbye! 👋',
				hideTitle: true,
			}),
		);
	},
};
