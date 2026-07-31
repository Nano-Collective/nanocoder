import React from 'react';
import {InfoMessage} from '@/components/message-box';
import {getVoicePreference, updateVoicePreference} from '@/config/preferences';
import type {VoicePlugin} from '@/hooks/useVoice';
import {generateKey} from '@/session/key-generator';
import type {Command} from '@/types/index';

export const voiceCommand: Command = {
	name: 'voice',
	description: 'Toggle voice input',
	handler: async () => {
		const currentConfig = getVoicePreference();
		const newState = !currentConfig.enabled;

		updateVoicePreference({
			...currentConfig,
			enabled: newState,
		});

		try {
			const plugin = (await import(
				'@nanocollective/nanocoder-voice'
			)) as VoicePlugin;
			await plugin.playPhrase(
				newState ? 'Voice mode activated' : 'Voice mode deactivated',
			);
		} catch (_error) {
			// Audio is a nice-to-have addition here, never a requirement for the command to succeed
		}

		return React.createElement(InfoMessage, {
			key: generateKey('voice-toggle'),
			message: `Voice mode ${newState ? 'enabled' : 'disabled'}.`,
		});
	},
};
