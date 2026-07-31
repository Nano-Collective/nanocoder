import test from 'ava';
import React from 'react';
import { render } from 'ink-testing-library';
import { useVoice, UseVoiceProps } from './useVoice.js';
import type { VoiceState } from '@/components/voice-status-bar';

// Helper component to test the hook
function TestComponent({
	handleUserSubmit,
	messages,
	addToChatQueue,
}: UseVoiceProps & {
	onStateChange?: (state: VoiceState) => void;
	triggerRef?: React.MutableRefObject<(() => void) | null>;
}) {
	const { state, startStopRecording } = useVoice({
		handleUserSubmit,
		messages,
		addToChatQueue,
	});

	React.useEffect(() => {
		// eslint-disable-next-line react/prop-types
		if (arguments[0].onStateChange) {
			// eslint-disable-next-line react/prop-types
			arguments[0].onStateChange(state);
		}
	}, [state]);

	React.useEffect(() => {
		// eslint-disable-next-line react/prop-types
		if (arguments[0].triggerRef) {
			// eslint-disable-next-line react/prop-types
			arguments[0].triggerRef.current = startStopRecording;
		}
	}, [startStopRecording]);

	return <></>;
}

// Since dynamic imports are hard to mock natively in Ava without proxyquire or similar,
// we will just ensure that if the plugin is not installed, it degrades gracefully.
// And we can write a test for graceful degradation.

test('gracefully handles missing voice plugin', async t => {
	const triggerRef = { current: null as (() => void) | null };
	const queue: React.ReactNode[] = [];

	render(
		<TestComponent
			handleUserSubmit={async () => {}}
			messages={[]}
			addToChatQueue={(comp) => queue.push(comp)}
			triggerRef={triggerRef}
		/>
	);

	if (triggerRef.current) {
		await triggerRef.current();
	}

	// We expect the queue to contain an ErrorMessage because the plugin import will fail in the test environment
	t.true(queue.length > 0);
	// In a real mock environment, we would use proxyquire or similar to mock @nanocollective/nanocoder-voice
	t.pass();
});
