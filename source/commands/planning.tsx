import {Command} from '@/types/index';
import React from 'react';
import InfoMessage from '@/components/info-message';
import {
	getPlanningPreferences,
	setPlanningPreferences,
} from '@/config/preferences';

export const planningCommand: Command = {
	name: 'planning',
	description: 'Toggle structured task planning on/off',
	handler: () => {
		const prefs = getPlanningPreferences();
		const newEnabled = !prefs.enabled;
		setPlanningPreferences({enabled: newEnabled});
		return Promise.resolve(
			React.createElement(InfoMessage, {
				hideBox: true,
				message: `Structured task planning: ${
					newEnabled ? 'enabled' : 'disabled'
				}`,
				key: `planning-${Date.now()}`,
			}),
		);
	},
};
