import {randomUUID} from 'node:crypto';
import {existsSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import React from 'react';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import type {VoiceState} from '@/components/voice-status-bar';
import {generateKey} from '@/session/key-generator';
import type {ImageAttachment, Message} from '@/types/core';
import {formatForSpeech} from '@/utils/format-for-speech';

export interface VoicePlugin {
	recordAudio: (
		filePath: string,
		durationMs?: number,
		signal?: AbortSignal,
	) => Promise<void>;
	transcribeAudio: (
		filePath: string,
		timeoutMs?: number,
		signal?: AbortSignal,
	) => Promise<string>;
	synthesizeSpeech: (
		text: string,
		outputPath: string,
		timeoutMs?: number,
		signal?: AbortSignal,
	) => Promise<void>;
	playAudio: (
		filePath: string,
		timeoutMs?: number,
		signal?: AbortSignal,
	) => Promise<void>;
	playPhrase: (phrase: string) => Promise<void>;
}

export interface UseVoiceProps {
	handleUserSubmit: (
		message: string,
		displayValue: string,
		images?: ImageAttachment[],
	) => Promise<void>;
	messages: Message[];
	addToChatQueue: (component: React.ReactNode) => void;
}

export interface UseVoiceReturn {
	state: VoiceState;
	startStopRecording: () => void;
}

export function useVoice({
	handleUserSubmit,
	messages,
	addToChatQueue,
}: UseVoiceProps): UseVoiceReturn {
	const [state, setState] = React.useState<VoiceState>('idle');

	const abortControllerRef = React.useRef<AbortController | null>(null);
	const recordingAudioPromiseRef = React.useRef<Promise<void> | null>(null);
	const activeFileRef = React.useRef<string | null>(null);

	const messagesRef = React.useRef(messages);
	React.useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	const cleanupActiveFile = React.useCallback(() => {
		if (activeFileRef.current && existsSync(activeFileRef.current)) {
			try {
				unlinkSync(activeFileRef.current);
			} catch {
				// Best effort
			}
			activeFileRef.current = null;
		}
	}, []);

	const startStopRecording = React.useCallback(async () => {
		if (state === 'listening') {
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
				abortControllerRef.current = null;
			}
			return;
		}

		if (state !== 'idle') {
			return;
		}

		let plugin: VoicePlugin;
		try {
			plugin = (await import('@nanocollective/nanocoder-voice')) as VoicePlugin;
		} catch (_error) {
			addToChatQueue(
				React.createElement(ErrorMessage, {
					key: generateKey('voice-error'),
					message:
						'Voice plugin not available. Please ensure @nanocollective/nanocoder-voice is installed.',
				}),
			);
			return;
		}

		setState('listening');
		const abortController = new AbortController();
		abortControllerRef.current = abortController;

		const recordingFile = join(
			tmpdir(),
			`nanocoder-recording-${randomUUID()}.wav`,
		);
		activeFileRef.current = recordingFile;

		try {
			const audioPromise = plugin.recordAudio(
				recordingFile,
				undefined,
				abortController.signal,
			);
			recordingAudioPromiseRef.current = audioPromise;

			try {
				await audioPromise;
			} catch (err) {
				// Aborting the recording is expected behavior for a toggle, it rejects with AbortError
				if (!(err instanceof Error) || !err.message?.includes('AbortError')) {
					throw err;
				}
			}
			recordingAudioPromiseRef.current = null;

			setState('processing');
			const transcribedText = await plugin.transcribeAudio(
				recordingFile,
				60000,
			);

			cleanupActiveFile();

			if (!transcribedText || transcribedText.trim() === '') {
				addToChatQueue(
					React.createElement(InfoMessage, {
						key: generateKey('voice-info'),
						message: 'No speech detected.',
					}),
				);
				setState('idle');
				return;
			}

			await handleUserSubmit(transcribedText, transcribedText);

			const currentMessages = messagesRef.current;
			const lastMessage = currentMessages[currentMessages.length - 1];

			if (lastMessage && lastMessage.role === 'assistant') {
				setState('speaking');
				const formattedText = formatForSpeech(lastMessage.content);

				if (formattedText.trim() !== '') {
					const ttsFile = join(tmpdir(), `nanocoder-tts-${randomUUID()}.wav`);
					activeFileRef.current = ttsFile;
					try {
						await plugin.synthesizeSpeech(formattedText, ttsFile);
						await plugin.playAudio(ttsFile);
					} catch (_audioErr) {
						addToChatQueue(
							React.createElement(ErrorMessage, {
								key: generateKey('voice-audio-error'),
								message: 'Failed to synthesize or play speech response.',
							}),
						);
					} finally {
						cleanupActiveFile();
					}
				}
			}

			setState('idle');
		} catch (error) {
			setState('idle');
			recordingAudioPromiseRef.current = null;
			abortControllerRef.current = null;
			cleanupActiveFile();

			if (error instanceof Error && error.name === 'AbortError') {
				return;
			}

			addToChatQueue(
				React.createElement(ErrorMessage, {
					key: generateKey('voice-error'),
					message: `Voice pipeline error: ${error instanceof Error ? error.message : String(error)}`,
				}),
			);
		}
	}, [state, handleUserSubmit, addToChatQueue, cleanupActiveFile]);

	return {
		state,
		startStopRecording,
	};
}
