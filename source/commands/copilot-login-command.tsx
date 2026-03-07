import React from 'react';
import {Command} from '@/types/index';
import {CopilotLogin} from './copilot-login';

const DEFAULT_PROVIDER_NAME = 'GitHub Copilot';

export const copilotLoginCommand: Command = {
	name: 'copilot-login',
	description:
		'Log in to GitHub Copilot (device flow). Saves credentials for the "GitHub Copilot" provider.',
	handler: (args: string[], _messages, _metadata) => {
		const providerName = args[0]?.trim() || DEFAULT_PROVIDER_NAME;
		return Promise.resolve(
			React.createElement(CopilotLogin, {
				providerName,
			}),
		);
	},
};
