import {UIStateProvider, useUIStateContext} from './useUIState.js';
import type {Completion} from '../types/components.js';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';

console.log('\nuseUIState.spec.ts');

// Helper component to test the hook
function TestConsumer({
	onRender,
}: {
	onRender: (state: ReturnType<typeof useUIStateContext>) => void;
}) {
	const state = useUIStateContext();
	React.useEffect(() => {
		onRender(state);
	}, [state, onRender]);
	return null;
}

test('UIStateProvider provides initial state', t => {
	let capturedState: ReturnType<typeof useUIStateContext> | null = null;

	render(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	t.truthy(capturedState);
	t.is(capturedState!.showClearMessage, false);
	t.is(capturedState!.showCompletions, false);
	t.deepEqual(capturedState!.completions, []);
	t.is(capturedState!.selectedCompletionIndex, -1);
	t.is(typeof capturedState!.setShowClearMessage, 'function');
	t.is(typeof capturedState!.setShowCompletions, 'function');
	t.is(typeof capturedState!.setCompletions, 'function');
	t.is(typeof capturedState!.setSelectedCompletionIndex, 'function');
	t.is(typeof capturedState!.resetUIState, 'function');
});

test('UIStateProvider allows updating showClearMessage', t => {
	let capturedState: ReturnType<typeof useUIStateContext> | null = null;

	const {rerender} = render(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	t.is(capturedState!.showClearMessage, false);

	// Update the state
	capturedState!.setShowClearMessage(true);
	rerender(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	t.is(capturedState!.showClearMessage, true);
});

test('UIStateProvider allows updating showCompletions', t => {
	let capturedState: ReturnType<typeof useUIStateContext> | null = null;

	const {rerender} = render(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	t.is(capturedState!.showCompletions, false);

	// Update the state
	capturedState!.setShowCompletions(true);
	rerender(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	t.is(capturedState!.showCompletions, true);
});

test('UIStateProvider allows updating completions', t => {
	let capturedState: ReturnType<typeof useUIStateContext> | null = null;

	const {rerender} = render(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	t.deepEqual(capturedState!.completions, []);

	const testCompletions: Completion[] = [
		{name: 'test1', isCustom: false},
		{name: 'test2', isCustom: true},
	];

	// Update the state
	capturedState!.setCompletions(testCompletions);
	rerender(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	t.deepEqual(capturedState!.completions, testCompletions);
});

test('UIStateProvider allows updating selectedCompletionIndex', t => {
	let capturedState: ReturnType<typeof useUIStateContext> | null = null;

	const {rerender} = render(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	t.is(capturedState!.selectedCompletionIndex, -1);

	// Update the state
	capturedState!.setSelectedCompletionIndex(2);
	rerender(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	t.is(capturedState!.selectedCompletionIndex, 2);
});

test('resetUIState resets all state to initial values', t => {
	let capturedState: ReturnType<typeof useUIStateContext> | null = null;

	const {rerender} = render(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	// Modify all state values
	capturedState!.setShowClearMessage(true);
	capturedState!.setShowCompletions(true);
	capturedState!.setCompletions([
		{name: 'test1', isCustom: false},
		{name: 'test2', isCustom: true},
	]);
	capturedState!.setSelectedCompletionIndex(1);

	rerender(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	t.is(capturedState!.showClearMessage, true);
	t.is(capturedState!.showCompletions, true);
	t.is(capturedState!.completions.length, 2);
	t.is(capturedState!.selectedCompletionIndex, 1);

	// Reset the state
	capturedState!.resetUIState();
	rerender(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	t.is(capturedState!.showClearMessage, false);
	t.is(capturedState!.showCompletions, false);
	t.deepEqual(capturedState!.completions, []);
	t.is(capturedState!.selectedCompletionIndex, -1);
});

test('UIStateProvider state updates are independent across renders', t => {
	let capturedState: ReturnType<typeof useUIStateContext> | null = null;

	const {rerender} = render(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	const initialShowClearMessage = capturedState!.showClearMessage;
	const initialShowCompletions = capturedState!.showCompletions;
	const initialCompletions = capturedState!.completions;

	// Update one state value
	capturedState!.setShowClearMessage(true);
	rerender(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedState = state;
				},
			}),
		),
	);

	// Only showClearMessage should change
	t.not(capturedState!.showClearMessage, initialShowClearMessage);
	t.is(capturedState!.showCompletions, initialShowCompletions);
	t.is(capturedState!.completions, initialCompletions);
});

test('UIStateProvider memoizes state object', t => {
	let capturedStates: ReturnType<typeof useUIStateContext>[] = [];

	const {rerender} = render(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedStates.push(state);
				},
			}),
		),
	);

	const firstState = capturedStates[capturedStates.length - 1];

	// Rerender without state changes
	rerender(
		React.createElement(
			UIStateProvider,
			null,
			React.createElement(TestConsumer, {
				onRender: state => {
					capturedStates.push(state);
				},
			}),
		),
	);

	const secondState = capturedStates[capturedStates.length - 1];

	// State object should be the same reference when no changes occur
	t.is(firstState, secondState);
});
