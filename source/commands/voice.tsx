import React from 'react';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import {getVoicePreference, updateVoicePreference} from '@/config/preferences';
import {defaultLoadPlugin} from '@/hooks/useVoice';
import type {Command} from '@/types/index';
import {generateKey} from '@/utils/key-generator';

export const voiceCommand: Command = {
	name: 'voice',
	description:
		'Turn voice mode on or off and configure it (/voice [on|off|status|hands-free|ptt|stt <local|cloud>|tts <local|cloud>])',
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
			messageText = 'Voice mode set to push-to-talk (Ctrl+G enabled).';
		} else if (subArg === 'stt') {
			if (param === 'cloud' || param === 'local') {
				updatedConfig.sttBackend = param;
				messageText =
					param === 'cloud'
						? 'Voice STT backend set to: cloud. Microphone audio will be sent to OpenAI for transcription.'
						: 'Voice STT backend set to: local.';
			} else {
				messageText = `Current STT backend: ${updatedConfig.sttBackend || 'local'}. Use '/voice stt local' or '/voice stt cloud'.`;
			}
		} else if (subArg === 'tts') {
			if (param === 'cloud' || param === 'local') {
				updatedConfig.ttsBackend = param;
				messageText =
					param === 'cloud'
						? 'Voice TTS backend set to: cloud. Generated speech text will be sent to OpenAI for synthesis.'
						: 'Voice TTS backend set to: local.';
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
				messageText = 'Voice mode set to push-to-talk (Ctrl+G enabled).';
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
				hideBox: true,
				key: generateKey('voice-command-error'),
				message: messageText,
			});
		}

		updateVoicePreference(updatedConfig);

		if (subArg !== 'status' && subArg !== 'stt' && subArg !== 'tts') {
			try {
				const plugin = await defaultLoadPlugin();
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
			hideBox: true,
			key: generateKey('voice-command-info'),
			message: messageText,
		});
	},
};
