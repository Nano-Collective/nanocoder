import React from 'react';
import {InfoMessage} from '@/components/message-box';
import {Command} from '@/types/index';
import {getShutdownManager} from '@/utils/shutdown';

function createExitCommand(name: string, description: string): Command {
	return {
		name,
		description,
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
}

export const exitCommand = createExitCommand('exit', 'Exit the application');
export const quitCommand = createExitCommand('quit', 'Quit the application');
