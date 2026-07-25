import React from 'react';
import {InfoMessage} from '@/components/message-box';
import {getVoicePreference, updateVoicePreference} from '@/config/preferences';
import {generateKey} from '@/session/key-generator';
import type {Command} from '@/types/index';

export const voiceCommand: Command = {
	name: 'voice',
	description: 'Toggle realtime voice mode (scaffolding only)',
	handler: async () => {
		const currentConfig = getVoicePreference();
		const newState = !currentConfig.enabled;

		updateVoicePreference({
			...currentConfig,
			enabled: newState,
		});

		return React.createElement(InfoMessage, {
			key: generateKey('voice-toggle'),
			message: `Voice mode ${
				newState ? 'enabled' : 'disabled'
			} (audio not yet wired — scaffolding only).`,
		});
	},
};
