import React from 'react';
import {InfoMessage} from '@/components/message-box';
import {getVoicePreference, updateVoicePreference} from '@/config/preferences';
import type {VoicePlugin} from '@/hooks/useVoice';
import {generateKey} from '@/session/key-generator';
import type {Command} from '@/types/index';

export const voiceCommand: Command = {
	name: 'voice',
	description:
		'Toggle voice input or set activation mode (/voice [hands-free|push-to-talk])',
	handler: async args => {
		const currentConfig = getVoicePreference();
		const subArg = args?.[0]?.toLowerCase();

		let messageText = '';
		const updatedConfig = {...currentConfig};

		if (subArg === 'hands-free' || subArg === 'handsfree') {
			updatedConfig.activationMode = 'hands-free';
			updatedConfig.enabled = true;
			messageText = 'Voice mode set to hands-free (VAD listening enabled).';
		} else if (subArg === 'push-to-talk' || subArg === 'ptt') {
			updatedConfig.activationMode = 'push-to-talk';
			messageText = 'Voice mode set to push-to-talk (Ctrl+T).';
		} else if (subArg === 'mode' && args?.[1]) {
			const mode = args[1].toLowerCase();
			if (mode === 'hands-free' || mode === 'handsfree') {
				updatedConfig.activationMode = 'hands-free';
				updatedConfig.enabled = true;
				messageText = 'Voice mode set to hands-free (VAD listening enabled).';
			} else {
				updatedConfig.activationMode = 'push-to-talk';
				messageText = 'Voice mode set to push-to-talk (Ctrl+T).';
			}
		} else {
			const newState = !currentConfig.enabled;
			updatedConfig.enabled = newState;
			messageText = `Voice mode ${newState ? 'enabled' : 'disabled'}.`;
		}

		updateVoicePreference(updatedConfig);

		try {
			const plugin = (await import(
				'@nanocollective/nanocoder-voice'
			)) as unknown as VoicePlugin;
			await plugin.playPhrase(
				updatedConfig.enabled
					? `Voice mode ${updatedConfig.activationMode} activated`
					: 'Voice mode deactivated',
			);
		} catch (_error) {
			// Audio phrase is optional
		}

		return React.createElement(InfoMessage, {
			key: generateKey('voice-toggle'),
			message: messageText,
		});
	},
};
