import React from 'react';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import {getVoicePreference, updateVoicePreference} from '@/config/preferences';
import type {VoicePlugin} from '@/hooks/useVoice';
import {generateKey} from '@/session/key-generator';
import type {Command} from '@/types/index';

export const voiceCommand: Command = {
	name: 'voice',
	description:
		'Configure voice mode (/voice [hands-free|ptt|stt <local|cloud>|tts <local|cloud>|status|mode <push-to-talk|hands-free>])',
	handler: async args => {
		const currentConfig = getVoicePreference();
		const updatedConfig = {...currentConfig};
		const subArg = args?.[0]?.toLowerCase();
		const param = args?.[1]?.toLowerCase();

		let messageText = '';
		let isError = false;

		if (subArg === 'hands-free' || subArg === 'handsfree') {
			updatedConfig.activationMode = 'hands-free';
			updatedConfig.enabled = true;
			messageText = 'Voice mode set to hands-free (VAD listening enabled).';
		} else if (subArg === 'push-to-talk' || subArg === 'ptt') {
			updatedConfig.activationMode = 'push-to-talk';
			updatedConfig.enabled = true;
			messageText = 'Voice mode set to push-to-talk (Ctrl+T enabled).';
		} else if (subArg === 'stt') {
			if (param === 'cloud' || param === 'local') {
				updatedConfig.sttBackend = param;
				messageText = `Voice STT backend set to: ${param}.`;
			} else {
				messageText = `Current STT backend: ${updatedConfig.sttBackend || 'local'}. Use '/voice stt local' or '/voice stt cloud'.`;
			}
		} else if (subArg === 'tts') {
			if (param === 'cloud' || param === 'local') {
				updatedConfig.ttsBackend = param;
				messageText = `Voice TTS backend set to: ${param}.`;
			} else {
				messageText = `Current TTS backend: ${updatedConfig.ttsBackend || 'local'}. Use '/voice tts local' or '/voice tts cloud'.`;
			}
		} else if (subArg === 'status') {
			messageText = [
				`Voice Mode: ${updatedConfig.enabled ? 'Enabled' : 'Disabled'}`,
				`Activation: ${updatedConfig.activationMode}`,
				`STT Backend: ${updatedConfig.sttBackend || 'local'}`,
				`TTS Backend: ${updatedConfig.ttsBackend || 'local'}`,
			].join('\n');
		} else if (subArg === 'mode') {
			if (param === 'hands-free' || param === 'handsfree') {
				updatedConfig.activationMode = 'hands-free';
				updatedConfig.enabled = true;
				messageText = 'Voice mode set to hands-free (VAD listening enabled).';
			} else if (param === 'push-to-talk' || param === 'ptt') {
				updatedConfig.activationMode = 'push-to-talk';
				updatedConfig.enabled = true;
				messageText = 'Voice mode set to push-to-talk (Ctrl+T enabled).';
			} else if (param) {
				isError = true;
				messageText = `Invalid voice mode '${param}'. Valid modes: push-to-talk, hands-free.`;
			} else {
				messageText = `Current activation mode: ${updatedConfig.activationMode}. Use '/voice mode push-to-talk' or '/voice mode hands-free'.`;
			}
		} else if (subArg === 'on') {
			updatedConfig.enabled = true;
			messageText = 'Voice mode enabled.';
		} else if (subArg === 'off') {
			updatedConfig.enabled = false;
			messageText = 'Voice mode disabled.';
		} else if (subArg) {
			isError = true;
			messageText = `Unknown voice command '${subArg}'. Use '/voice [hands-free|ptt|stt <local|cloud>|tts <local|cloud>|status|mode <push-to-talk|hands-free>]'.`;
		} else {
			// Default toggle
			const newState = !currentConfig.enabled;
			updatedConfig.enabled = newState;
			messageText = `Voice mode ${newState ? 'enabled' : 'disabled'}.`;
		}

		if (isError) {
			return React.createElement(ErrorMessage, {
				key: generateKey('voice-command-error'),
				message: messageText,
			});
		}

		updateVoicePreference(updatedConfig);

		if (subArg !== 'status' && subArg !== 'stt' && subArg !== 'tts') {
			try {
				const plugin = (await import(
					'@nanocollective/nanocoder-voice'
				)) as VoicePlugin;
				await plugin.playPhrase(
					updatedConfig.enabled
						? 'Voice mode activated'
						: 'Voice mode deactivated',
				);
			} catch (_error) {
				// Audio phrase is optional
			}
		}

		return React.createElement(InfoMessage, {
			key: generateKey('voice-command-info'),
			message: messageText,
		});
	},
};
