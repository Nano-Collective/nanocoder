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
	/**
	 * Injectable plugin loader; defaults to the real dynamic import.
	 * Override in tests to supply a mock without touching the module registry.
	 */
	loadPlugin?: () => Promise<VoicePlugin>;
}

export interface UseVoiceReturn {
	state: VoiceState;
	startStopRecording: () => void;
}

export function useVoice({
	handleUserSubmit,
	messages,
	addToChatQueue,
	loadPlugin = async () =>
		(await import('@nanocollective/nanocoder-voice')) as unknown as VoicePlugin,
}: UseVoiceProps): UseVoiceReturn {
	const [state, setState] = React.useState<VoiceState>('idle');

	const abortControllerRef = React.useRef<AbortController | null>(null);
	const recordingAudioPromiseRef = React.useRef<Promise<void> | null>(null);
	const activeFileRef = React.useRef<string | null>(null);

	// Deferred TTS state: armed just before handleUserSubmit is awaited so the
	// messages-watching useEffect below can drive the TTS step on the next render.
	//
	// Why not read messages immediately after `await handleUserSubmit`?
	//
	// handleUserSubmit (→ handleChatMessage → processAssistantResponse) fully
	// awaits the entire LLM response and calls React's setMessages() before its
	// promise resolves. However setMessages() only *schedules* a React state
	// update — the updated messages array is NOT reflected in this hook's
	// `messages` prop (or any ref driven by useEffect) until after the next
	// render cycle. Arming these refs and letting a useEffect drive the speaking
	// → idle transition is the correct, race-free pattern here.
	const pluginRef = React.useRef<VoicePlugin | null>(null);
	const pendingTTSRef = React.useRef(false);

	const cleanupActiveFile = React.useCallback(() => {
		if (activeFileRef.current && existsSync(activeFileRef.current)) {
			try {
				unlinkSync(activeFileRef.current);
			} catch {
				// Best effort — temp file cleanup should never fail the pipeline
			}

			activeFileRef.current = null;
		}
	}, []);

	// Abort and clean up temp files on unmount to avoid stale operations
	React.useEffect(() => {
		return () => {
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
				abortControllerRef.current = null;
			}

			pendingTTSRef.current = false;
			pluginRef.current = null;
			cleanupActiveFile();
		};
	}, [cleanupActiveFile]);

	// Deferred TTS: fires after React commits the updated messages prop.
	// pendingTTSRef is armed in startStopRecording before handleUserSubmit is
	// awaited, so this effect is guaranteed to run with the assistant reply in
	// `messages` regardless of how React schedules the re-render.
	React.useEffect(() => {
		if (!pendingTTSRef.current || !pluginRef.current) return;

		const lastMsg = messages[messages.length - 1];
		if (!lastMsg || lastMsg.role !== 'assistant') return;

		const plugin = pluginRef.current;
		const formattedText = formatForSpeech(lastMsg.content);
		pendingTTSRef.current = false;
		pluginRef.current = null;

		if (formattedText.trim() === '') {
			setState('idle');
			return;
		}

		setState('speaking');
		const ttsFile = join(tmpdir(), `nanocoder-tts-${randomUUID()}.wav`);
		activeFileRef.current = ttsFile;

		plugin
			.synthesizeSpeech(formattedText, ttsFile)
			.then(async () => plugin.playAudio(ttsFile))
			.catch(() => {
				addToChatQueue(
					React.createElement(ErrorMessage, {
						key: generateKey('voice-audio-error'),
						message: 'Failed to synthesize or play speech response.',
					}),
				);
			})
			.finally(() => {
				cleanupActiveFile();
				setState('idle');
			});
	}, [messages, addToChatQueue, cleanupActiveFile]);

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
			plugin = await loadPlugin();
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
				// Aborting the recording is expected for toggle-to-stop. A proper
				// AbortError (name === 'AbortError') propagates to the outer catch
				// where it is handled gracefully. Only rethrow non-abort errors.
				if (!(err instanceof Error) || !err.message?.includes('AbortError')) {
					throw err;
				}
			}

			recordingAudioPromiseRef.current = null;

			setState('processing');
			const transcribedText = await plugin.transcribeAudio(
				recordingFile,
				60_000,
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

			// Arm deferred TTS BEFORE awaiting handleUserSubmit. By the time the
			// promise resolves the LLM reply is in the pipeline, but React hasn't
			// re-rendered yet. The messages useEffect above drives the
			// processing → speaking → idle transition once the messages prop updates.
			pendingTTSRef.current = true;
			pluginRef.current = plugin;

			await handleUserSubmit(transcribedText, transcribedText);
			// Intentionally no setState here — the deferred TTS useEffect owns the
			// remaining state transitions.
		} catch (error) {
			// Reset deferred TTS in case it was armed before the error occurred
			pendingTTSRef.current = false;
			pluginRef.current = null;
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
	}, [state, handleUserSubmit, addToChatQueue, cleanupActiveFile, loadPlugin]);

	return {
		state,
		startStopRecording,
	};
}
