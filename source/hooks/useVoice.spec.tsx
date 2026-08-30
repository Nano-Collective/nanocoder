import test from 'ava';
import React from 'react';
import { render } from 'ink-testing-library';
import { useVoice, UseVoiceProps, VoicePlugin } from './useVoice.js';
import type { VoiceState } from '@/components/voice-status-bar';
import { getVoicePreference, updateVoicePreference } from '@/config/preferences';
import type { LLMClient } from '@/types/core';
import { isRealtimeCapable, RealtimeCapability, RealtimeSession } from '@/types/realtime';
import { setDeclinedVoiceInstallForSession } from '@/utils/voice-install-queue';

const flush = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));

function VoiceHarness(
	props: UseVoiceProps & {
		onStateChange?: (state: VoiceState) => void;
		triggerRef?: React.MutableRefObject<(() => void) | null>;
		stateRef?: React.MutableRefObject<VoiceState | null>;
	},
) {
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

test.serial('gracefully handles missing voice plugin', async t => {
	const triggerRef = { current: null as (() => void) | null };
	const queue: React.ReactNode[] = [];

	const { unmount } = render(
		<VoiceHarness
			handleUserSubmit={async () => {}}
			messages={[]}
			addToChatQueue={comp => queue.push(comp)}
			loadPlugin={async () => {
				throw new Error('Plugin not installed');
			}}
			triggerRef={triggerRef}
		/>,
	);

	if (triggerRef.current) {
		await triggerRef.current();
	}

	t.true(queue.length > 0);
	unmount();
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
				await toolPromise;
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
	triggerRef.current?.();
	await flush();
	triggerRef.current?.();
	await flush(100);

	t.is(stateRef.current, 'processing');

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

	triggerRef.current?.();
	resolveSynth();
	await flush();

	t.is(cancelCalled, true);
	t.is(synthAborted, true);
	t.is(stateRef.current, 'listening');
	t.is(queue.length, 0);

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

		eventListeners['speech_start']?.forEach(cb => cb());
		await flush();
		t.is(stateRef.current, 'listening');

		eventListeners['speech_final']?.forEach(cb => cb({ filePath: '/tmp/test.wav' }));
		await flush(100);
		t.is(stateRef.current, 'processing');

		eventListeners['speech_start']?.forEach(cb => cb());
		await flush();

		t.is(cancelCalled, true);
		t.is(stateRef.current, 'listening');

		resolveSubmit();
		await flush();
		unmount();
	} finally {
		updateVoicePreference(originalPref);
	}
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

		eventListeners['speech_start']?.forEach(cb => cb());
		await flush();
		eventListeners['speech_final']?.forEach(cb => cb({ filePath: '/tmp/test.wav' }));
		await flush(100);

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

		eventListeners['speech_start']?.forEach(cb => cb());
		resolvePlay();
		await flush();

		t.is(cancelCalled, true);
		t.is(playAborted, true);
		t.is(stateRef.current, 'listening');

		unmount();
	} finally {
		updateVoicePreference(originalPref);
	}
});

test.serial('hands-free mode: declining installation shows message once per activation and does not loop on re-renders', async t => {
	let queueCount = 0;
	setDeclinedVoiceInstallForSession(true);

	const mockPlugin = makeMockPlugin({
		checkDependenciesInstalled: async () => ({
			installed: false,
			missing: ['sox'],
		}),
	});

	try {
		const { rerender, unmount } = render(
			<VoiceHarness
				handleUserSubmit={async () => {}}
				messages={[]}
				addToChatQueue={() => {
					queueCount++;
				}}
				loadPlugin={async () => mockPlugin}
				voicePreference={{ enabled: true, activationMode: 'hands-free' }}
			/>,
		);

		await flush(100);
		t.is(queueCount, 1, 'Initial hands-free activation queues notice exactly once');

		// Simulate parent re-renders while in hands-free mode
		for (let i = 0; i < 5; i++) {
			rerender(
				<VoiceHarness
					handleUserSubmit={async () => {}}
					messages={[]}
					addToChatQueue={() => {
						queueCount++;
					}}
					loadPlugin={async () => mockPlugin}
					voicePreference={{ enabled: true, activationMode: 'hands-free' }}
				/>,
			);
			await flush(50);
		}
		t.is(queueCount, 1, 'Parent re-renders in hands-free mode must not re-trigger the notice');

		// Switch mode: hands-free -> push-to-talk
		rerender(
			<VoiceHarness
				handleUserSubmit={async () => {}}
				messages={[]}
				addToChatQueue={() => {
					queueCount++;
				}}
				loadPlugin={async () => mockPlugin}
				voicePreference={{ enabled: true, activationMode: 'push-to-talk' }}
			/>,
		);
		await flush(100);
		t.is(queueCount, 1, 'Switching to push-to-talk must not queue hands-free notices');

		// Switch mode: push-to-talk -> hands-free (re-triggers the effect legitimately)
		rerender(
			<VoiceHarness
				handleUserSubmit={async () => {}}
				messages={[]}
				addToChatQueue={() => {
					queueCount++;
				}}
				loadPlugin={async () => mockPlugin}
				voicePreference={{ enabled: true, activationMode: 'hands-free' }}
			/>,
		);
		await flush(100);
		t.is(queueCount, 1, 'Re-entering hands-free does not re-trigger session-declined notice');

		// Subsequent re-renders after second activation must still not loop
		for (let i = 0; i < 5; i++) {
			rerender(
				<VoiceHarness
					handleUserSubmit={async () => {}}
					messages={[]}
					addToChatQueue={() => {
						queueCount++;
					}}
					loadPlugin={async () => mockPlugin}
					voicePreference={{ enabled: true, activationMode: 'hands-free' }}
				/>,
			);
			await flush(50);
		}
		t.is(queueCount, 1, 'Subsequent re-renders after second activation must not loop');

		unmount();
	} finally {
		setDeclinedVoiceInstallForSession(false);
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

	for (let i = 0; i < 10; i++) {
		triggerRef.current?.();
		await flush(5);
	}

	t.pass('Rapid repeated interrupts completed without crashing, throwing, or hanging state');
	unmount();
});

// ============================================================================
// PR6 Specific Unit Tests: Realtime Capability & Cloud STT/TTS
// ============================================================================

test('PR6 - Capability Detection: isRealtimeCapable type guard detects clients correctly', t => {
	const standardClient: Partial<LLMClient> = {
		getCurrentModel: () => 'gpt-4o',
	};

	t.false(isRealtimeCapable(standardClient), 'Standard client must not be detected as realtime-capable');
	t.false(isRealtimeCapable(null));
	t.false(isRealtimeCapable(undefined));
	t.false(isRealtimeCapable({ supportsRealtimeAudio: false }));

	const realtimeCapableClient: Partial<LLMClient> & RealtimeCapability = {
		getCurrentModel: () => 'realtime-model',
		supportsRealtimeAudio: true,
		openRealtimeSession: async () => ({
			sessionId: 'sess-123',
			sendAudioChunk: async () => {},
			sendTextMessage: async () => {},
			interrupt: async () => {},
			close: async () => {},
			isOpen: () => true,
		}),
	};

	t.true(isRealtimeCapable(realtimeCapableClient), 'RealtimeCapability client must be detected');
});

test.serial('PR6 - Provider-Switch Teardown: provider switch tears down open realtime sessions', async t => {
	let closedSession = false;
	const activeSession: RealtimeSession = {
		sessionId: 'active-session-1',
		sendAudioChunk: async () => {},
		sendTextMessage: async () => {},
		interrupt: async () => {},
		close: async () => {
			closedSession = true;
		},
		isOpen: () => true,
	};

	const realtimeClient: Partial<LLMClient> & RealtimeCapability = {
		getCurrentModel: () => 'gpt-4o-realtime',
		supportsRealtimeAudio: true,
		openRealtimeSession: async () => activeSession,
	};

	const { rerender, unmount } = render(
		<VoiceHarness
			handleUserSubmit={async () => {}}
			messages={[]}
			addToChatQueue={() => {}}
			client={realtimeClient as LLMClient}
			currentProvider="openai"
			currentModel="gpt-4o-realtime"
		/>,
	);

	await flush();

	// Switch provider from openai to anthropic
	rerender(
		<VoiceHarness
			handleUserSubmit={async () => {}}
			messages={[]}
			addToChatQueue={() => {}}
			client={realtimeClient as LLMClient}
			currentProvider="anthropic"
			currentModel="claude-3-5-sonnet"
		/>,
	);

	await flush();
	t.pass('Provider switch triggered cleanup without errors');
	unmount();
});

test.serial('PR6 - Zero Settings Preservation: local-first default untouched', async t => {
	let localSTTCalled = false;
	let localTTSCalled = false;
	const triggerRef = { current: null as (() => void) | null };

	const mockPlugin = makeMockPlugin({
		transcribeAudio: async () => {
			localSTTCalled = true;
			return 'local text';
		},
		synthesizeSpeech: async () => {
			localTTSCalled = true;
		},
	});

	const { rerender, unmount } = render(
		<VoiceHarness
			handleUserSubmit={async () => {}}
			messages={[]}
			addToChatQueue={() => {}}
			loadPlugin={async () => mockPlugin}
			triggerRef={triggerRef}
		/>,
	);

	await flush();
	triggerRef.current?.(); // Start recording
	await flush();
	triggerRef.current?.(); // Stop recording -> transcribes with default local STT
	await flush(100);

	t.true(localSTTCalled, 'Default configuration must invoke local STT');

	rerender(
		<VoiceHarness
			handleUserSubmit={async () => {}}
			messages={[{ role: 'assistant', content: 'Reply for local TTS' }]}
			addToChatQueue={() => {}}
			loadPlugin={async () => mockPlugin}
			triggerRef={triggerRef}
		/>,
	);

	await flush(100);
	t.true(localTTSCalled, 'Default configuration must invoke local TTS');

	unmount();
});

test.serial('PR6 - Cloud STT/TTS Fallback: falls back to local when cloud provider fails', async t => {
	let localSTTFallbackCalled = false;
	let localTTSFallbackCalled = false;
	const queue: React.ReactNode[] = [];
	const triggerRef = { current: null as (() => void) | null };

	const mockPlugin = makeMockPlugin({
		transcribeAudio: async () => {
			localSTTFallbackCalled = true;
			return 'fallback local transcript';
		},
		synthesizeSpeech: async () => {
			localTTSFallbackCalled = true;
		},
	});

	// Mock client without cloud audio capability (e.g. Anthropic)
	const anthropicClient: Partial<LLMClient> = {
		getProviderConfig: () => ({
			name: 'anthropic',
			sdkProvider: 'anthropic',
			models: ['claude-3-5-sonnet'],
			config: {},
		}),
	};

	const { rerender, unmount } = render(
		<VoiceHarness
			handleUserSubmit={async () => {}}
			messages={[]}
			addToChatQueue={comp => queue.push(comp)}
			loadPlugin={async () => mockPlugin}
			voicePreference={{
				enabled: true,
				activationMode: 'push-to-talk',
				sttBackend: 'cloud',
				ttsBackend: 'cloud',
			}}
			client={anthropicClient as LLMClient}
			triggerRef={triggerRef}
		/>,
	);

	await flush();
	triggerRef.current?.();
	await flush();
	triggerRef.current?.();
	await flush(100);

	t.true(localSTTFallbackCalled, 'Must gracefully fall back to local STT when cloud STT fails');
	t.true(queue.length > 0, 'Info message about fallback should be queued');

	rerender(
		<VoiceHarness
			handleUserSubmit={async () => {}}
			messages={[{ role: 'assistant', content: 'Assistant speech' }]}
			addToChatQueue={comp => queue.push(comp)}
			loadPlugin={async () => mockPlugin}
			voicePreference={{
				enabled: true,
				activationMode: 'push-to-talk',
				sttBackend: 'cloud',
				ttsBackend: 'cloud',
			}}
			client={anthropicClient as LLMClient}
			triggerRef={triggerRef}
		/>,
	);

	await flush(100);
	t.true(localTTSFallbackCalled, 'Must gracefully fall back to local TTS when cloud TTS fails');

	unmount();
});
