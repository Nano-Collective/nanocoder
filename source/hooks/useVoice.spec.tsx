import test from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';
import type {UseVoiceProps, VoicePlugin} from './useVoice.js';
import {useVoice} from './useVoice.js';
import type {VoiceState} from '@/components/voice-status-bar.js';
import type {Message} from '@/types/core.js';

/** Build a complete mock plugin; any method not overridden resolves immediately. */
function makeMockPlugin(overrides: Partial<VoicePlugin> = {}): VoicePlugin {
	return {
		recordAudio: async () => {},
		transcribeAudio: async () => 'hello world',
		synthesizeSpeech: async () => {},
		playAudio: async () => {},
		playPhrase: async () => {},
		...overrides,
	};
}

/**
 * Minimal test harness. Keeps messages as React state so the deferred-TTS
 * useEffect in useVoice fires correctly when handleUserSubmit appends a reply.
 * The `simulateReply` flag controls whether handleUserSubmit adds an assistant
 * message (mimicking what the real app does).
 */
function VoiceHarness({
	loadPlugin,
	onStateChange,
	triggerRef,
	queueRef,
	simulateReply = true,
	voicePreference,
}: {
	loadPlugin: UseVoiceProps['loadPlugin'];
	onStateChange?: (state: VoiceState) => void;
	triggerRef: React.MutableRefObject<(() => void) | null>;
	queueRef: React.MutableRefObject<React.ReactNode[]>;
	simulateReply?: boolean;
	voicePreference?: import('@/types/config').VoiceConfig;
}) {
	const [messages, setMessages] = React.useState<Message[]>([]);

	const handleUserSubmit = React.useCallback(async () => {
		if (simulateReply) {
			setMessages(prev => [
				...prev,
				{role: 'assistant' as const, content: 'Test reply.'},
			]);
		}
	}, [simulateReply]);

	const stableOnStateChange = React.useCallback(
		(s: VoiceState) => {
			onStateChange?.(s);
		},
		[onStateChange],
	);

	const {state, startStopRecording} = useVoice({
		handleUserSubmit,
		messages,
		addToChatQueue: comp => {
			queueRef.current.push(comp);
		},
		loadPlugin,
		voicePreference,
	});

	React.useEffect(() => {
		stableOnStateChange(state);
	}, [state, stableOnStateChange]);

	React.useEffect(() => {
		triggerRef.current = startStopRecording;
	}, [startStopRecording, triggerRef]);

	return <></>;
}

/**
 * Flush microtasks and macrotask ticks so async state updates and React
 * effects settle between test steps.
 */
async function flush(ticks = 3) {
	for (let i = 0; i < 4; i++) {
		await Promise.resolve();
	}

	for (let i = 0; i < ticks; i++) {
		await new Promise<void>(r => setTimeout(r, 0));
	}
}

// ─────────────────────────────────────────────────────────────────────────────

test('gracefully handles missing voice plugin', async t => {
	const triggerRef = {current: null as (() => void) | null};
	const queueRef = {current: [] as React.ReactNode[]};

	render(
		<VoiceHarness
			loadPlugin={async () => {
				throw new Error('Module not found');
			}}
			triggerRef={triggerRef}
			queueRef={queueRef}
		/>,
	);

	await flush();
	await triggerRef.current!();
	await flush();

	t.is(queueRef.current.length, 1, 'should queue exactly one error message');

	const queued = queueRef.current[0] as React.ReactElement<{message: string}>;
	t.true(
		queued.props.message.includes(
			'Voice plugin not available. Please ensure @nanocollective/nanocoder-voice is installed.',
		),
		'error message should identify the missing plugin',
	);
});

test('full successful cycle: completes without error and ends at idle', async t => {
	// React 19 automatic batching merges rapid setState calls within the same
	// async tick, so we cannot rely on observing every intermediate state
	// (listening/processing/speaking) as distinct renders through a useEffect.
	// We assert the observable outcomes instead: no errors queued, state returns
	// to idle, and all plugin methods were called exactly once.
	const triggerRef = {current: null as (() => void) | null};
	const queueRef = {current: [] as React.ReactNode[]};

	const calls = {
		recordAudio: 0,
		transcribeAudio: 0,
		synthesizeSpeech: 0,
		playAudio: 0,
	};

	const finalStates: VoiceState[] = [];

	render(
		<VoiceHarness
			loadPlugin={async () =>
				makeMockPlugin({
					recordAudio: async () => {
						calls.recordAudio++;
					},
					transcribeAudio: async () => {
						calls.transcribeAudio++;
						return 'hello world';
					},
					synthesizeSpeech: async () => {
						calls.synthesizeSpeech++;
					},
					playAudio: async () => {
						calls.playAudio++;
					},
				})
			}
			onStateChange={s => {
				finalStates.push(s);
			}}
			triggerRef={triggerRef}
			queueRef={queueRef}
		/>,
	);

	await flush();
	await triggerRef.current!();
	await flush(5); // let the deferred TTS useEffect fire and TTS chain complete

	t.is(finalStates.at(-1), 'idle', 'state should be idle after full cycle');
	t.is(queueRef.current.length, 0, 'no error messages should be queued');
	t.is(calls.recordAudio, 1, 'recordAudio called once');
	t.is(calls.transcribeAudio, 1, 'transcribeAudio called once');
	t.is(calls.synthesizeSpeech, 1, 'synthesizeSpeech called once');
	t.is(calls.playAudio, 1, 'playAudio called once');
});

test('graceful failure when recordAudio throws', async t => {
	const states: VoiceState[] = [];
	const triggerRef = {current: null as (() => void) | null};
	const queueRef = {current: [] as React.ReactNode[]};

	render(
		<VoiceHarness
			loadPlugin={async () =>
				makeMockPlugin({
					recordAudio: async () => {
						throw new Error('Microphone access denied');
					},
				})
			}
			onStateChange={s => {
				states.push(s);
			}}
			triggerRef={triggerRef}
			queueRef={queueRef}
		/>,
	);

	await flush();
	await triggerRef.current!();
	await flush();

	t.is(states.at(-1), 'idle', 'should return to idle after recordAudio failure');
	t.is(queueRef.current.length, 1, 'should queue exactly one error message');

	const queued = queueRef.current[0] as React.ReactElement<{message: string}>;
	t.true(
		queued.props.message.includes('Voice pipeline error'),
		'error message should identify a pipeline error',
	);
});

test('graceful failure when transcribeAudio throws', async t => {
	const states: VoiceState[] = [];
	const triggerRef = {current: null as (() => void) | null};
	const queueRef = {current: [] as React.ReactNode[]};

	render(
		<VoiceHarness
			loadPlugin={async () =>
				makeMockPlugin({
					transcribeAudio: async () => {
						throw new Error('Whisper timed out');
					},
				})
			}
			onStateChange={s => {
				states.push(s);
			}}
			triggerRef={triggerRef}
			queueRef={queueRef}
		/>,
	);

	await flush();
	await triggerRef.current!();
	await flush();

	t.is(
		states.at(-1),
		'idle',
		'should return to idle after transcribeAudio failure',
	);
	t.is(queueRef.current.length, 1, 'should queue exactly one error message');

	const queued = queueRef.current[0] as React.ReactElement<{message: string}>;
	t.true(
		queued.props.message.includes('Voice pipeline error'),
		'error message should identify a pipeline error',
	);
});

test('manual abort mid-recording returns cleanly to idle', async t => {
	const states: VoiceState[] = [];
	const triggerRef = {current: null as (() => void) | null};
	const queueRef = {current: [] as React.ReactNode[]};

	// recordAudio hangs until the AbortSignal fires, then rejects with AbortError
	const mockPlugin = makeMockPlugin({
		recordAudio: async (_path, _duration, signal) =>
			new Promise<void>((_resolve, reject) => {
				const onAbort = () => {
					const err = Object.assign(new Error('The operation was aborted.'), {
						name: 'AbortError',
					});
					reject(err);
				};

				if (signal?.aborted) {
					onAbort();
					return;
				}

				signal?.addEventListener('abort', onAbort);
			}),
	});

	render(
		<VoiceHarness
			loadPlugin={async () => mockPlugin}
			onStateChange={s => {
				states.push(s);
			}}
			triggerRef={triggerRef}
			queueRef={queueRef}
		/>,
	);

	await flush();

	// First press — start recording (do not await; the function is hanging)
	const done = triggerRef.current!();
	await flush(); // let state settle to 'listening' and triggerRef update

	t.is(states.at(-1), 'listening', 'should be listening after first press');

	// Second press — abort the recording
	triggerRef.current!();
	await done; // wait for the first startStopRecording call to exit cleanly
	await flush();

	t.is(states.at(-1), 'idle', 'should return to idle after abort');
	t.is(queueRef.current.length, 0, 'no error messages should be queued');
});

test('hands-free VAD persists across multiple consecutive speech_start/speech_final cycles', async t => {
	const eventListeners: Record<string, ((...args: any[]) => void)[]> = {};
	let startCount = 0;
	let stopCount = 0;

	const mockVad = {
		start: () => {
			startCount++;
		},
		stop: () => {
			stopCount++;
		},
		on: (event: string, cb: (...args: any[]) => void) => {
			eventListeners[event] = eventListeners[event] || [];
			eventListeners[event].push(cb);
		},
	};

	const mockPlugin = makeMockPlugin({
		createVadEngine: () => mockVad,
		transcribeAudio: async () => 'hello from vad',
	});

	const triggerRef = { current: null as (() => void) | null };
	const queueRef = { current: [] as React.ReactNode[] };

	render(
		<VoiceHarness
			loadPlugin={async () => mockPlugin}
			triggerRef={triggerRef}
			queueRef={queueRef}
			voicePreference={{
				enabled: true,
				activationMode: 'hands-free',
				sttBackend: 'local',
				ttsBackend: 'local',
			}}
		/>,
	);

	await flush(5);

	t.is(startCount, 1, 'VAD engine should start once upon mount');
	t.is(stopCount, 0, 'VAD engine should not stop');

	// Cycle 1: speech_start -> speech_final
	eventListeners['speech_start']?.forEach(cb => cb());
	await flush();
	eventListeners['speech_final']?.forEach(cb => cb({ filePath: '/tmp/test1.wav' }));
	await flush(5);

	t.is(stopCount, 0, 'VAD engine must NOT stop after first utterance cycle');

	// Cycle 2: speech_start -> speech_final (on exact same VAD engine mock instance)
	eventListeners['speech_start']?.forEach(cb => cb());
	await flush();
	eventListeners['speech_final']?.forEach(cb => cb({ filePath: '/tmp/test2.wav' }));
	await flush(5);

	t.is(stopCount, 0, 'VAD engine must NOT stop after second utterance cycle');
	t.is(startCount, 1, 'VAD engine should remain continuously active without restarting');
});
