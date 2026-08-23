import test from 'ava';
import React from 'react';
import { render } from 'ink-testing-library';
import { useVoice, UseVoiceProps, VoicePlugin } from './useVoice.js';
import type { VoiceState } from '@/components/voice-status-bar';
import { getVoicePreference, updateVoicePreference } from '@/config/preferences';

const flush = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));

function VoiceHarness(props: UseVoiceProps & {
	onStateChange?: (state: VoiceState) => void;
	triggerRef?: React.MutableRefObject<(() => void) | null>;
	stateRef?: React.MutableRefObject<VoiceState | null>;
}) {
	const { state, startStopRecording } = useVoice(props);

	React.useEffect(() => {
		props.onStateChange?.(state);
		if (props.stateRef) {
			props.stateRef.current = state;
		}
	}, [state, props]);

	React.useEffect(() => {
		if (props.triggerRef) {
			props.triggerRef.current = startStopRecording;
		}
	}, [startStopRecording, props.triggerRef]);

	return <></>;
}

function makeMockPlugin(overrides: Partial<VoicePlugin> = {}): VoicePlugin {
	return {
		recordAudio: async (_file, _duration, signal) => {
			return new Promise(resolve => {
				if (signal?.aborted) return resolve();
				const onAbort = () => {
					signal?.removeEventListener('abort', onAbort);
					resolve();
				};
				signal?.addEventListener('abort', onAbort);
			});
		},
		transcribeAudio: async () => 'hello voice',
		synthesizeSpeech: async () => {},
		playAudio: async () => {},
		playPhrase: async () => {},
		...overrides,
	};
}

test('gracefully handles missing voice plugin', async t => {
	const triggerRef = { current: null as (() => void) | null };
	const queue: React.ReactNode[] = [];

	render(
		<VoiceHarness
			handleUserSubmit={async () => {}}
			messages={[]}
			addToChatQueue={(comp) => queue.push(comp)}
			triggerRef={triggerRef}
		/>
	);

	if (triggerRef.current) {
		await triggerRef.current();
	}

	t.true(queue.length > 0);
	t.pass();
});

test.serial('push-to-talk barge-in during generation (processing state)', async t => {
	let cancelCalled = false;
	let recordCount = 0;
	const triggerRef = { current: null as (() => void) | null };
	const stateRef = { current: null as VoiceState | null };

	let resolveSubmit: () => void = () => {};
	const submitPromise = new Promise<void>(resolve => {
		resolveSubmit = resolve;
	});

	const mockPlugin = makeMockPlugin({
		recordAudio: async (_file, _duration, signal) => {
			recordCount++;
			return new Promise(resolve => {
				if (signal?.aborted) return resolve();
				const onAbort = () => {
					signal?.removeEventListener('abort', onAbort);
					resolve();
				};
				signal?.addEventListener('abort', onAbort);
			});
		},
		transcribeAudio: async () => 'hello text',
	});

	const { unmount } = render(
		<VoiceHarness
			handleUserSubmit={async () => {
				await submitPromise;
			}}
			messages={[]}
			addToChatQueue={() => {}}
			loadPlugin={async () => mockPlugin}
			handleCancel={() => {
				cancelCalled = true;
			}}
			triggerRef={triggerRef}
			stateRef={stateRef}
		/>,
	);

	await flush();
	// 1. Start recording (state -> listening)
	triggerRef.current?.();
	await flush();
	t.is(stateRef.current, 'listening');

	// 2. Stop recording -> transcribes -> calls handleUserSubmit (state -> processing)
	triggerRef.current?.();
	await flush(100);

	t.is(stateRef.current, 'processing');
	t.is(cancelCalled, false);

	// 3. User presses Ctrl+T (barge-in) while in processing state
	triggerRef.current?.();
	await flush();

	t.is(cancelCalled, true, 'handleCancel should be called on barge-in during processing');
	t.is(stateRef.current, 'listening', 'State should immediately transition to listening');

	// Stop recording cycle before unmounting
	triggerRef.current?.();
	resolveSubmit();
	await flush();
	unmount();
});

test.serial('push-to-talk barge-in during tool execution', async t => {
	let cancelCalled = false;
	const triggerRef = { current: null as (() => void) | null };
	const stateRef = { current: null as VoiceState | null };

	let resolveTool: () => void = () => {};
	const toolPromise = new Promise<void>(resolve => {
		resolveTool = resolve;
	});

	const mockPlugin = makeMockPlugin({
		transcribeAudio: async () => 'run heavy tool',
	});

	const { unmount } = render(
		<VoiceHarness
			handleUserSubmit={async () => {
				await toolPromise; // simulate tool execution
			}}
			messages={[]}
			addToChatQueue={() => {}}
			loadPlugin={async () => mockPlugin}
			handleCancel={() => {
				cancelCalled = true;
			}}
			triggerRef={triggerRef}
			stateRef={stateRef}
		/>,
	);

	await flush();
	triggerRef.current?.(); // Start recording
	await flush();
	triggerRef.current?.(); // Stop recording -> transcribe -> submit tool
	await flush(100);

	t.is(stateRef.current, 'processing');

	// Barge-in during tool execution
	triggerRef.current?.();
	await flush();

	t.is(cancelCalled, true);
	t.is(stateRef.current, 'listening');

	triggerRef.current?.();
	resolveTool();
	await flush();
	unmount();
});

test.serial('push-to-talk barge-in during TTS synthesis (synthesizeSpeech)', async t => {
	let cancelCalled = false;
	let synthAborted = false;
	const triggerRef = { current: null as (() => void) | null };
	const stateRef = { current: null as VoiceState | null };
	const queue: React.ReactNode[] = [];

	let resolveSynth: () => void = () => {};
	const synthPromise = new Promise<void>(resolve => {
		resolveSynth = resolve;
	});

	const mockPlugin = makeMockPlugin({
		transcribeAudio: async () => 'question',
		synthesizeSpeech: async (_text, _out, _timeout, signal) => {
			signal?.addEventListener('abort', () => {
				synthAborted = true;
			});
			await synthPromise;
			if (signal?.aborted) {
				throw new Error('AbortError: Speech synthesis aborted');
			}
		},
	});

	const { rerender, unmount } = render(
		<VoiceHarness
			handleUserSubmit={async () => {}}
			messages={[]}
			addToChatQueue={comp => queue.push(comp)}
			loadPlugin={async () => mockPlugin}
			handleCancel={() => {
				cancelCalled = true;
			}}
			triggerRef={triggerRef}
			stateRef={stateRef}
		/>,
	);

	await flush();
	triggerRef.current?.(); // start
	await flush();
	triggerRef.current?.(); // stop -> process -> submit
	await flush(100);

	// Update messages with assistant response
	rerender(
		<VoiceHarness
			handleUserSubmit={async () => {}}
			messages={[{ role: 'assistant', content: 'Assistant reply' }]}
			addToChatQueue={comp => queue.push(comp)}
			loadPlugin={async () => mockPlugin}
			handleCancel={() => {
				cancelCalled = true;
			}}
			triggerRef={triggerRef}
			stateRef={stateRef}
		/>,
	);

	await flush(100);
	t.is(stateRef.current, 'speaking');

	// Barge-in during synthesis
	triggerRef.current?.();
	resolveSynth();
	await flush();

	t.is(cancelCalled, true);
	t.is(synthAborted, true);
	t.is(stateRef.current, 'listening');
	t.is(queue.length, 0, 'Abort error should be suppressed, no error card queued');

	triggerRef.current?.();
	await flush();
	unmount();
});

test.serial('push-to-talk barge-in during TTS playback (playAudio)', async t => {
	let cancelCalled = false;
	let playAborted = false;
	const triggerRef = { current: null as (() => void) | null };
	const stateRef = { current: null as VoiceState | null };
	const queue: React.ReactNode[] = [];

	let resolvePlay: () => void = () => {};
	const playPromise = new Promise<void>(resolve => {
		resolvePlay = resolve;
	});

	const mockPlugin = makeMockPlugin({
		transcribeAudio: async () => 'question',
		synthesizeSpeech: async () => {}, // instant synth
		playAudio: async (_file, _timeout, signal) => {
			signal?.addEventListener('abort', () => {
				playAborted = true;
			});
			await playPromise;
			if (signal?.aborted) {
				throw new Error('AbortError: Playback aborted');
			}
		},
	});

	const { rerender, unmount } = render(
		<VoiceHarness
			handleUserSubmit={async () => {}}
			messages={[]}
			addToChatQueue={comp => queue.push(comp)}
			loadPlugin={async () => mockPlugin}
			handleCancel={() => {
				cancelCalled = true;
			}}
			triggerRef={triggerRef}
			stateRef={stateRef}
		/>,
	);

	await flush();
	triggerRef.current?.();
	await flush();
	triggerRef.current?.();
	await flush(100);

	rerender(
		<VoiceHarness
			handleUserSubmit={async () => {}}
			messages={[{ role: 'assistant', content: 'Assistant reply' }]}
			addToChatQueue={comp => queue.push(comp)}
			loadPlugin={async () => mockPlugin}
			handleCancel={() => {
				cancelCalled = true;
			}}
			triggerRef={triggerRef}
			stateRef={stateRef}
		/>,
	);

	await flush(100);
	t.is(stateRef.current, 'speaking');

	// Barge-in during audio playback
	triggerRef.current?.();
	resolvePlay();
	await flush();

	t.is(cancelCalled, true);
	t.is(playAborted, true);
	t.is(stateRef.current, 'listening');
	t.is(queue.length, 0);

	triggerRef.current?.();
	await flush();
	unmount();
});

test.serial('hands-free VAD speech_start barge-in during processing state', async t => {
	const eventListeners: Record<string, ((...args: any[]) => void)[]> = {};
	let cancelCalled = false;
	const stateRef = { current: null as VoiceState | null };

	let resolveSubmit: () => void = () => {};
	const submitPromise = new Promise<void>(resolve => {
		resolveSubmit = resolve;
	});

	const mockVad = {
		start: () => {},
		stop: () => {},
		on: (event: string, cb: (...args: any[]) => void) => {
			eventListeners[event] = eventListeners[event] || [];
			eventListeners[event].push(cb);
		},
	};

	const mockPlugin = makeMockPlugin({
		createVadEngine: () => mockVad,
		transcribeAudio: async () => 'hello from vad',
	});

	const originalPref = getVoicePreference();
	updateVoicePreference({ ...originalPref, enabled: true, activationMode: 'hands-free' });

	try {
		const { unmount } = render(
			<VoiceHarness
				handleUserSubmit={async () => {
					await submitPromise;
				}}
				messages={[]}
				addToChatQueue={() => {}}
				loadPlugin={async () => mockPlugin}
				handleCancel={() => {
					cancelCalled = true;
				}}
				stateRef={stateRef}
			/>,
		);

		await flush(100);

		// VAD detects initial speech
		eventListeners['speech_start']?.forEach(cb => cb());
		await flush();
		t.is(stateRef.current, 'listening');

		eventListeners['speech_final']?.forEach(cb => cb({ filePath: '/tmp/test.wav' }));
		await flush(100);
		t.is(stateRef.current, 'processing');

		// User starts talking while processing (VAD barge-in)
		eventListeners['speech_start']?.forEach(cb => cb());
		await flush();

		t.is(cancelCalled, true, 'VAD speech_start during processing must trigger handleCancel');
		t.is(stateRef.current, 'listening', 'State must transition to listening for new utterance');

		resolveSubmit();
		await flush();
		unmount();
	} finally {
		updateVoicePreference(originalPref);
	}
});

test.serial('rapid repeated interrupts stress test', async t => {
	let cancelCount = 0;
	const triggerRef = { current: null as (() => void) | null };
	const stateRef = { current: null as VoiceState | null };

	const mockPlugin = makeMockPlugin({
		transcribeAudio: async () => 'rapid text',
		synthesizeSpeech: async () => {},
		playAudio: async () => {},
	});

	const { unmount } = render(
		<VoiceHarness
			handleUserSubmit={async () => {
				await flush(20);
			}}
			messages={[]}
			addToChatQueue={() => {}}
			loadPlugin={async () => mockPlugin}
			handleCancel={() => {
				cancelCount++;
			}}
			triggerRef={triggerRef}
			stateRef={stateRef}
		/>,
	);

	await flush();

	// Rapidly trigger barge-in interrupts 10 times in quick succession
	for (let i = 0; i < 10; i++) {
		triggerRef.current?.();
		await flush(5);
	}

	t.pass('Rapid repeated interrupts completed without crashing, throwing, or hanging state');
	unmount();
});

test.serial('hands-free VAD speech_start barge-in during speaking state', async t => {
	const eventListeners: Record<string, ((...args: any[]) => void)[]> = {};
	let cancelCalled = false;
	let playAborted = false;
	const stateRef = { current: null as VoiceState | null };

	let resolvePlay: () => void = () => {};
	const playPromise = new Promise<void>(resolve => {
		resolvePlay = resolve;
	});

	const mockVad = {
		start: () => {},
		stop: () => {},
		on: (event: string, cb: (...args: any[]) => void) => {
			eventListeners[event] = eventListeners[event] || [];
			eventListeners[event].push(cb);
		},
	};

	const mockPlugin = makeMockPlugin({
		createVadEngine: () => mockVad,
		transcribeAudio: async () => 'initial speech',
		synthesizeSpeech: async () => {},
		playAudio: async (_file, _timeout, signal) => {
			signal?.addEventListener('abort', () => {
				playAborted = true;
			});
			await playPromise;
			if (signal?.aborted) {
				throw new Error('AbortError: Playback aborted');
			}
		},
	});

	const originalPref = getVoicePreference();
	updateVoicePreference({ ...originalPref, enabled: true, activationMode: 'hands-free' });

	try {
		const { rerender, unmount } = render(
			<VoiceHarness
				handleUserSubmit={async () => {}}
				messages={[]}
				addToChatQueue={() => {}}
				loadPlugin={async () => mockPlugin}
				handleCancel={() => {
					cancelCalled = true;
				}}
				stateRef={stateRef}
			/>,
		);

		await flush(100);

		// Trigger initial turn
		eventListeners['speech_start']?.forEach(cb => cb());
		await flush();
		eventListeners['speech_final']?.forEach(cb => cb({ filePath: '/tmp/test.wav' }));
		await flush(100);

		// Assistant produces message -> transitions to speaking
		rerender(
			<VoiceHarness
				handleUserSubmit={async () => {}}
				messages={[{ role: 'assistant', content: 'Speaking assistant response' }]}
				addToChatQueue={() => {}}
				loadPlugin={async () => mockPlugin}
				handleCancel={() => {
					cancelCalled = true;
				}}
				stateRef={stateRef}
			/>,
		);

		await flush(100);
		t.is(stateRef.current, 'speaking');

		// VAD detects user speaking mid-playback (barge-in!)
		eventListeners['speech_start']?.forEach(cb => cb());
		resolvePlay();
		await flush();

		t.is(cancelCalled, true, 'handleCancel should be called on VAD speech_start during speaking');
		t.is(playAborted, true, 'Active audio playback should be aborted');
		t.is(stateRef.current, 'listening', 'State must immediately transition to listening');

		unmount();
	} finally {
		updateVoicePreference(originalPref);
	}
});
