import {randomUUID} from 'node:crypto';
import {existsSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import React from 'react';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import type {VoiceState} from '@/components/voice-status-bar';
import {getVoicePreference} from '@/config/preferences';
import {generateKey} from '@/session/key-generator';
import type {Message} from '@/types/index';
import {formatForSpeech} from '@/utils/format-for-speech';
import {
	hasDeclinedVoiceInstallForSession,
	setDeclinedVoiceInstallForSession,
	signalVoiceInstallPrompt,
} from '@/utils/voice-install-queue';

export interface VoicePlugin {
	recordAudio: (
		filePath: string,
		durationMs?: number,
		signal?: AbortSignal,
	) => Promise<void>;
	playAudio: (
		filePath: string,
		timeoutMs?: number,
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
	playPhrase: (text: string) => Promise<void>;
	checkDependenciesInstalled?: (
		customCheck?: unknown,
	) => Promise<{installed: boolean; missing: ('sox' | 'whisper' | 'piper')[]}>;
	installDependencies?: (options?: unknown) => Promise<void>;
	createVadEngine?: (options?: unknown) => unknown;
}

export interface UseVoiceProps {
	handleUserSubmit: (
		submittedText: string,
		displayText: string,
	) => Promise<void>;
	messages: Message[];
	addToChatQueue: (component: React.ReactNode) => void;
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

	// Keep refs tracking mutable props & state to decouple VAD lifecycle from re-renders
	const stateRef = React.useRef(state);
	React.useEffect(() => {
		stateRef.current = state;
	}, [state]);

	const handleUserSubmitRef = React.useRef(handleUserSubmit);
	React.useEffect(() => {
		handleUserSubmitRef.current = handleUserSubmit;
	}, [handleUserSubmit]);

	const addToChatQueueRef = React.useRef(addToChatQueue);
	React.useEffect(() => {
		addToChatQueueRef.current = addToChatQueue;
	}, [addToChatQueue]);

	const abortControllerRef = React.useRef<AbortController | null>(null);
	const recordingAudioPromiseRef = React.useRef<Promise<void> | null>(null);
	const activeFileRef = React.useRef<string | null>(null);

	const pluginRef = React.useRef<VoicePlugin | null>(null);
	const pendingTTSRef = React.useRef(false);
	const ttsTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const vadEngineRef = React.useRef<unknown>(null);

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

	const ensureDependencies = React.useCallback(
		async (plugin: VoicePlugin): Promise<boolean> => {
			if (!plugin.checkDependenciesInstalled) {
				return true;
			}

			try {
				const check = await plugin.checkDependenciesInstalled();
				if (check.installed) {
					return true;
				}

				if (hasDeclinedVoiceInstallForSession()) {
					addToChatQueueRef.current(
						React.createElement(InfoMessage, {
							key: generateKey('voice-dep-declined'),
							message:
								'Voice mode dependencies missing. Installation declined for this session.',
						}),
					);
					return false;
				}

				const approved = await signalVoiceInstallPrompt({
					missing: check.missing,
					installDependencies: async onProgress => {
						if (plugin.installDependencies) {
							await plugin.installDependencies({onProgress});
						}
					},
				});

				if (!approved) {
					setDeclinedVoiceInstallForSession(true);
					addToChatQueueRef.current(
						React.createElement(InfoMessage, {
							key: generateKey('voice-dep-declined'),
							message: 'Voice dependency installation cancelled.',
						}),
					);
					return false;
				}

				return true;
			} catch (err) {
				addToChatQueueRef.current(
					React.createElement(ErrorMessage, {
						key: generateKey('voice-dep-error'),
						message: `Voice dependency setup failed: ${err instanceof Error ? err.message : String(err)}`,
					}),
				);
				return false;
			}
		},
		[],
	);

	React.useEffect(() => {
		return () => {
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
				abortControllerRef.current = null;
			}

			if (ttsTimeoutRef.current) {
				clearTimeout(ttsTimeoutRef.current);
				ttsTimeoutRef.current = null;
			}

			if (vadEngineRef.current) {
				const engine = vadEngineRef.current as {stop?: () => void};
				if (typeof engine.stop === 'function') {
					engine.stop();
				}
				vadEngineRef.current = null;
			}

			pendingTTSRef.current = false;
			pluginRef.current = null;
			cleanupActiveFile();
		};
	}, [cleanupActiveFile]);

	// Hands-free VAD effect - DECOUPLED FROM `state` and prop changes to persist continuously across utterances
	React.useEffect(() => {
		const pref = getVoicePreference();
		if (!pref.enabled || pref.activationMode !== 'hands-free') {
			if (vadEngineRef.current) {
				const engine = vadEngineRef.current as {stop?: () => void};
				if (typeof engine.stop === 'function') {
					engine.stop();
				}
				vadEngineRef.current = null;
			}
			return;
		}

		if (vadEngineRef.current) {
			return;
		}

		let isCancelled = false;

		const initVad = async () => {
			let plugin: VoicePlugin;
			try {
				plugin = await loadPlugin();
			} catch {
				return;
			}

			const depsOk = await ensureDependencies(plugin);
			if (!depsOk || isCancelled) return;

			if (!plugin.createVadEngine) return;

			const engine = plugin.createVadEngine() as {
				start: () => void;
				stop: () => void;
				// biome-ignore lint/suspicious/noExplicitAny: event handler callback
				on: (event: string, cb: (...args: any[]) => void) => void;
			};

			engine.on('speech_start', () => {
				if (stateRef.current === 'idle') {
					setState('listening');
				}
			});

			engine.on('speech_final', async (evt: {filePath: string}) => {
				if (stateRef.current !== 'listening') return;

				setState('processing');
				activeFileRef.current = evt.filePath;
				try {
					const transcribed = await plugin.transcribeAudio(
						evt.filePath,
						60_000,
					);
					cleanupActiveFile();

					if (!transcribed || transcribed.trim() === '') {
						addToChatQueueRef.current(
							React.createElement(InfoMessage, {
								key: generateKey('voice-vad-no-speech'),
								message: 'No speech detected.',
							}),
						);
						setState('idle');
						return;
					}

					pendingTTSRef.current = true;
					pluginRef.current = plugin;

					ttsTimeoutRef.current = setTimeout(() => {
						if (pendingTTSRef.current) {
							pendingTTSRef.current = false;
							pluginRef.current = null;
							ttsTimeoutRef.current = null;
							setState('idle');
						}
					}, 90_000);

					await handleUserSubmitRef.current(transcribed, transcribed);
				} catch (err) {
					cleanupActiveFile();
					setState('idle');
					addToChatQueueRef.current(
						React.createElement(ErrorMessage, {
							key: generateKey('voice-vad-error'),
							message: `VAD pipeline error: ${err instanceof Error ? err.message : String(err)}`,
						}),
					);
				}
			});

			engine.on('error', (err: Error) => {
				addToChatQueueRef.current(
					React.createElement(ErrorMessage, {
						key: generateKey('voice-vad-engine-error'),
						message: `VAD engine error: ${err.message}`,
					}),
				);
			});

			engine.start();
			vadEngineRef.current = engine;
		};

		void initVad();

		return () => {
			isCancelled = true;
			if (vadEngineRef.current) {
				const engine = vadEngineRef.current as {stop?: () => void};
				if (typeof engine.stop === 'function') {
					engine.stop();
				}
				vadEngineRef.current = null;
			}
		};
	}, [loadPlugin, ensureDependencies, cleanupActiveFile]);

	React.useEffect(() => {
		if (!pendingTTSRef.current || !pluginRef.current) return;

		const lastMsg = messages[messages.length - 1];
		if (!lastMsg || lastMsg.role !== 'assistant') return;

		if (ttsTimeoutRef.current) {
			clearTimeout(ttsTimeoutRef.current);
			ttsTimeoutRef.current = null;
		}

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
				addToChatQueueRef.current(
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
	}, [messages, cleanupActiveFile]);

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
			addToChatQueueRef.current(
				React.createElement(ErrorMessage, {
					key: generateKey('voice-error'),
					message:
						'Voice plugin not available. Please ensure @nanocollective/nanocoder-voice is installed.',
				}),
			);
			return;
		}

		const depsOk = await ensureDependencies(plugin);
		if (!depsOk) {
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
				addToChatQueueRef.current(
					React.createElement(InfoMessage, {
						key: generateKey('voice-info'),
						message: 'No speech detected.',
					}),
				);
				setState('idle');
				return;
			}

			pendingTTSRef.current = true;
			pluginRef.current = plugin;

			ttsTimeoutRef.current = setTimeout(() => {
				if (pendingTTSRef.current) {
					pendingTTSRef.current = false;
					pluginRef.current = null;
					ttsTimeoutRef.current = null;
					setState('idle');
				}
			}, 90_000);

			await handleUserSubmitRef.current(transcribedText, transcribedText);
		} catch (error) {
			if (ttsTimeoutRef.current) {
				clearTimeout(ttsTimeoutRef.current);
				ttsTimeoutRef.current = null;
			}

			pendingTTSRef.current = false;
			pluginRef.current = null;
			setState('idle');
			recordingAudioPromiseRef.current = null;
			abortControllerRef.current = null;
			cleanupActiveFile();

			if (error instanceof Error && error.name === 'AbortError') {
				return;
			}

			addToChatQueueRef.current(
				React.createElement(ErrorMessage, {
					key: generateKey('voice-error'),
					message: `Voice pipeline error: ${error instanceof Error ? error.message : String(error)}`,
				}),
			);
		}
	}, [state, loadPlugin, ensureDependencies, cleanupActiveFile]);

	return {
		state,
		startStopRecording,
	};
}
