import {randomUUID} from 'node:crypto';
import {existsSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import React from 'react';
import {ErrorMessage, InfoMessage} from '@/components/message-box';
import type {VoiceState} from '@/components/voice-status-bar';
import {getVoicePreference} from '@/config/preferences';
import {
	synthesizeCloudSpeech,
	transcribeCloudAudio,
} from '@/services/cloud-audio';
import {generateKey} from '@/session/key-generator';
import type {ImageAttachment, LLMClient, Message} from '@/types/core';
import {isRealtimeCapable, type RealtimeSession} from '@/types/realtime';
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
	installDependencies?: (options?: {
		onProgress?: (step: string, percent: number) => void;
		installRunner?: (command: string, args: string[]) => Promise<void>;
	}) => Promise<void>;
	createVadEngine?: (options?: unknown) => unknown;
}

export interface UseVoiceProps {
	handleUserSubmit: (
		submittedText: string,
		displayText: string,
		images?: ImageAttachment[],
	) => Promise<void>;
	messages: Message[];
	addToChatQueue: (component: React.ReactNode) => void;
	loadPlugin?: () => Promise<VoicePlugin>;
	voicePreference?: {
		enabled: boolean;
		activationMode: string;
		sttBackend?: 'local' | 'cloud';
		ttsBackend?: 'local' | 'cloud';
	};
	handleCancel?: () => void;
	client?: LLMClient | null;
	currentProvider?: string;
	currentModel?: string;
}

export interface UseVoiceReturn {
	state: VoiceState;
	startStopRecording: () => void;
	isRealtimeCapable: boolean;
	activeRealtimeSession: RealtimeSession | null;
}

const defaultLoadPlugin = async (): Promise<VoicePlugin> =>
	(await import('@nanocollective/nanocoder-voice')) as unknown as VoicePlugin;

export function useVoice({
	handleUserSubmit,
	messages,
	addToChatQueue,
	loadPlugin = defaultLoadPlugin,
	voicePreference,
	handleCancel,
	client,
	currentProvider,
	currentModel,
}: UseVoiceProps): UseVoiceReturn {
	const [state, setState] = React.useState<VoiceState>('idle');

	const stateRef = React.useRef(state);
	React.useEffect(() => {
		stateRef.current = state;
	}, [state]);

	const handleCancelRef = React.useRef(handleCancel);
	React.useEffect(() => {
		handleCancelRef.current = handleCancel;
	}, [handleCancel]);

	const handleUserSubmitRef = React.useRef(handleUserSubmit);
	React.useEffect(() => {
		handleUserSubmitRef.current = handleUserSubmit;
	}, [handleUserSubmit]);

	const addToChatQueueRef = React.useRef(addToChatQueue);
	React.useEffect(() => {
		addToChatQueueRef.current = addToChatQueue;
	}, [addToChatQueue]);

	const loadPluginRef = React.useRef(loadPlugin);
	React.useEffect(() => {
		loadPluginRef.current = loadPlugin;
	}, [loadPlugin]);

	const clientRef = React.useRef(client);
	React.useEffect(() => {
		clientRef.current = client;
	}, [client]);

	const voicePreferenceRef = React.useRef(voicePreference);
	React.useEffect(() => {
		voicePreferenceRef.current = voicePreference;
	}, [voicePreference]);

	const abortControllerRef = React.useRef<AbortController | null>(null);
	const ttsAbortControllerRef = React.useRef<AbortController | null>(null);
	const recordingAudioPromiseRef = React.useRef<Promise<void> | null>(null);
	const activeFileRef = React.useRef<string | null>(null);

	const pluginRef = React.useRef<VoicePlugin | null>(null);
	const pendingTTSRef = React.useRef(false);
	const ttsTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const vadEngineRef = React.useRef<unknown>(null);
	const hasCheckedHandsFreeDepsRef = React.useRef(false);
	const activeRealtimeSessionRef = React.useRef<RealtimeSession | null>(null);

	const hasRealtime = React.useMemo(() => isRealtimeCapable(client), [client]);

	// Provider/model switch teardown gap fix: explicitly tear down any open realtime session on switch
	// biome-ignore lint/correctness/useExhaustiveDependencies: Teardown on provider/model/client switch
	React.useEffect(() => {
		if (activeRealtimeSessionRef.current) {
			void activeRealtimeSessionRef.current.close().catch(() => {});
			activeRealtimeSessionRef.current = null;
		}
	}, [currentProvider, currentModel, client]);

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

	// Central interrupt helper — idempotent across mid-generation, mid-tool, mid-synthesis, mid-playback
	const interrupt = React.useCallback(() => {
		stateRef.current = 'listening';
		setState('listening');

		if (ttsAbortControllerRef.current) {
			ttsAbortControllerRef.current.abort();
			ttsAbortControllerRef.current = null;
		}

		if (ttsTimeoutRef.current) {
			clearTimeout(ttsTimeoutRef.current);
			ttsTimeoutRef.current = null;
		}
		pendingTTSRef.current = false;
		pluginRef.current = null;

		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}

		if (activeRealtimeSessionRef.current) {
			void activeRealtimeSessionRef.current.interrupt().catch(() => {});
		}

		cleanupActiveFile();

		handleCancelRef.current?.();
	}, [cleanupActiveFile]);

	const ensureDependencies = React.useCallback(
		async (plugin: VoicePlugin): Promise<boolean> => {
			if (!plugin.checkDependenciesInstalled) {
				return true;
			}

			try {
				const check = await plugin.checkDependenciesInstalled();
				if (check.installed || check.missing.length === 0) {
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

			if (ttsAbortControllerRef.current) {
				ttsAbortControllerRef.current.abort();
				ttsAbortControllerRef.current = null;
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

			if (activeRealtimeSessionRef.current) {
				void activeRealtimeSessionRef.current.close().catch(() => {});
				activeRealtimeSessionRef.current = null;
			}

			pendingTTSRef.current = false;
			pluginRef.current = null;
			cleanupActiveFile();
		};
	}, [cleanupActiveFile]);

	// Extract reactive primitive values from voicePreference prop or disk default
	const currentPref = voicePreference ?? getVoicePreference();
	const enabled = currentPref.enabled;
	const activationMode = currentPref.activationMode;

	// Hands-free VAD effect - REACTIVE to enabled and activationMode changes
	React.useEffect(() => {
		if (!enabled || activationMode !== 'hands-free') {
			hasCheckedHandsFreeDepsRef.current = false;
			if (vadEngineRef.current) {
				const engine = vadEngineRef.current as {stop?: () => void};
				if (typeof engine.stop === 'function') {
					engine.stop();
				}
				vadEngineRef.current = null;
			}
			return;
		}

		if (vadEngineRef.current || hasCheckedHandsFreeDepsRef.current) {
			return;
		}

		hasCheckedHandsFreeDepsRef.current = true;
		let isCancelled = false;

		const initVad = async () => {
			let plugin: VoicePlugin;
			try {
				plugin = await (loadPluginRef.current || defaultLoadPlugin)();
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
				const currState = stateRef.current;
				if (currState === 'processing' || currState === 'speaking') {
					interrupt();
				} else if (currState === 'idle') {
					setState('listening');
				}
			});

			engine.on('speech_final', async (evt: {filePath: string}) => {
				if (stateRef.current !== 'listening') return;

				setState('processing');
				activeFileRef.current = evt.filePath;
				try {
					const pref = voicePreferenceRef.current ?? getVoicePreference();
					let transcribed = '';

					if (pref.sttBackend === 'cloud') {
						try {
							transcribed = await transcribeCloudAudio(evt.filePath, {
								providerConfig: clientRef.current?.getProviderConfig(),
								timeoutMs: 60_000,
							});
						} catch (cloudErr) {
							addToChatQueueRef.current(
								React.createElement(InfoMessage, {
									key: generateKey('voice-cloud-stt-fallback'),
									message: `Cloud STT fallback to local (${cloudErr instanceof Error ? cloudErr.message : String(cloudErr)})`,
								}),
							);
							transcribed = await plugin.transcribeAudio(evt.filePath, 60_000);
						}
					} else {
						transcribed = await plugin.transcribeAudio(evt.filePath, 60_000);
					}

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
	}, [
		enabled,
		activationMode,
		ensureDependencies,
		cleanupActiveFile,
		interrupt,
	]);

	// TTS response playback effect
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

		const ttsAbortController = new AbortController();
		ttsAbortControllerRef.current = ttsAbortController;

		const synthesize = async () => {
			const pref = voicePreferenceRef.current ?? getVoicePreference();
			if (pref.ttsBackend === 'cloud') {
				try {
					await synthesizeCloudSpeech(formattedText, ttsFile, {
						providerConfig: clientRef.current?.getProviderConfig(),
						timeoutMs: 60_000,
						signal: ttsAbortController.signal,
					});
					return;
				} catch (cloudErr) {
					if (ttsAbortController.signal.aborted) throw cloudErr;
					addToChatQueueRef.current(
						React.createElement(InfoMessage, {
							key: generateKey('voice-cloud-tts-fallback'),
							message: `Cloud TTS fallback to local (${cloudErr instanceof Error ? cloudErr.message : String(cloudErr)})`,
						}),
					);
					await plugin.synthesizeSpeech(
						formattedText,
						ttsFile,
						60_000,
						ttsAbortController.signal,
					);
				}
			} else {
				await plugin.synthesizeSpeech(
					formattedText,
					ttsFile,
					60_000,
					ttsAbortController.signal,
				);
			}
		};

		synthesize()
			.then(async () => {
				if (ttsAbortController.signal.aborted) return;
				return plugin.playAudio(ttsFile, 60_000, ttsAbortController.signal);
			})
			.catch(audioErr => {
				if (
					audioErr instanceof Error &&
					audioErr.message?.includes('AbortError')
				) {
					return;
				}
				addToChatQueueRef.current(
					React.createElement(ErrorMessage, {
						key: generateKey('voice-audio-error'),
						message: 'Failed to synthesize or play speech response.',
					}),
				);
			})
			.finally(() => {
				if (ttsAbortControllerRef.current === ttsAbortController) {
					ttsAbortControllerRef.current = null;
				}
				cleanupActiveFile();
				if (stateRef.current === 'speaking') {
					setState('idle');
				}
			});
	}, [messages, cleanupActiveFile]);

	// Push-to-talk recording trigger callback
	const startStopRecording = React.useCallback(async () => {
		const currState = stateRef.current;
		if (currState === 'listening') {
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
				abortControllerRef.current = null;
			}

			return;
		}

		if (currState === 'processing' || currState === 'speaking') {
			// Interrupt active generation / tool execution / speech synthesis / speech playback
			interrupt();
			// Fall through to start a new recording cycle immediately!
		} else if (currState !== 'idle') {
			return;
		}

		let plugin: VoicePlugin;
		try {
			plugin = await (loadPluginRef.current || defaultLoadPlugin)();
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

			// If state was changed away from listening (e.g. interrupted), cancel submission
			if (stateRef.current !== 'listening') {
				cleanupActiveFile();
				return;
			}

			setState('processing');

			const pref = voicePreferenceRef.current ?? getVoicePreference();
			let transcribedText = '';

			if (pref.sttBackend === 'cloud') {
				try {
					transcribedText = await transcribeCloudAudio(recordingFile, {
						providerConfig: clientRef.current?.getProviderConfig(),
						timeoutMs: 60_000,
					});
				} catch (cloudErr) {
					addToChatQueueRef.current(
						React.createElement(InfoMessage, {
							key: generateKey('voice-cloud-stt-fallback'),
							message: `Cloud STT fallback to local (${cloudErr instanceof Error ? cloudErr.message : String(cloudErr)})`,
						}),
					);
					transcribedText = await plugin.transcribeAudio(recordingFile, 60_000);
				}
			} else {
				transcribedText = await plugin.transcribeAudio(recordingFile, 60_000);
			}

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
	}, [ensureDependencies, cleanupActiveFile, interrupt]);

	return {
		state,
		startStopRecording,
		isRealtimeCapable: hasRealtime,
		activeRealtimeSession: activeRealtimeSessionRef.current,
	};
}
