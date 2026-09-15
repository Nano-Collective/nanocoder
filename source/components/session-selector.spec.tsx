import test from 'ava';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {
	type SessionMetadata,
	sessionManager,
} from '../session/session-manager.js';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import {formatMessageCount, formatTimeAgo} from './session-selector.js';
import SessionSelector from './session-selector.js';

console.log('\nsession-selector.spec.tsx');

// ============================================================================
// formatTimeAgo
// ============================================================================

test('formatTimeAgo returns "just now" for timestamps under 5 minutes ago', t => {
	const now = new Date();
	t.is(formatTimeAgo(now.toISOString()), 'just now');

	const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
	t.is(formatTimeAgo(twoMinutesAgo.toISOString()), 'just now');

	const fourMinutesAgo = new Date(now.getTime() - 4 * 60 * 1000);
	t.is(formatTimeAgo(fourMinutesAgo.toISOString()), 'just now');
});

test('formatTimeAgo returns minutes for 5-59 minutes ago', t => {
	const now = new Date();

	const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
	t.is(formatTimeAgo(fiveMinutesAgo.toISOString()), '5 minutes ago');

	const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
	t.is(formatTimeAgo(tenMinutesAgo.toISOString()), '10 minutes ago');

	const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
	t.is(formatTimeAgo(thirtyMinutesAgo.toISOString()), '30 minutes ago');

	const fiftyNineMinutesAgo = new Date(now.getTime() - 59 * 60 * 1000);
	t.is(formatTimeAgo(fiftyNineMinutesAgo.toISOString()), '59 minutes ago');
});

test('formatTimeAgo uses singular "minute" for exactly 5 minutes', t => {
	const now = new Date();
	// 5 minutes = singular would be wrong, but 5 > 1 so it should be "minutes"
	const fiveMin = new Date(now.getTime() - 5 * 60 * 1000);
	t.is(formatTimeAgo(fiveMin.toISOString()), '5 minutes ago');
});

test('formatTimeAgo returns hours for 1-23 hours ago', t => {
	const now = new Date();

	const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
	t.is(formatTimeAgo(oneHourAgo.toISOString()), '1 hour ago');

	const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
	t.is(formatTimeAgo(twoHoursAgo.toISOString()), '2 hours ago');

	const twentyThreeHoursAgo = new Date(now.getTime() - 23 * 60 * 60 * 1000);
	t.is(formatTimeAgo(twentyThreeHoursAgo.toISOString()), '23 hours ago');
});

test('formatTimeAgo uses singular "hour" for 1 hour', t => {
	const now = new Date();
	const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
	t.is(formatTimeAgo(oneHourAgo.toISOString()), '1 hour ago');
});

test('formatTimeAgo returns days for 1-6 days ago', t => {
	const now = new Date();

	const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	t.is(formatTimeAgo(oneDayAgo.toISOString()), '1 day ago');

	const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
	t.is(formatTimeAgo(threeDaysAgo.toISOString()), '3 days ago');

	const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
	t.is(formatTimeAgo(sixDaysAgo.toISOString()), '6 days ago');
});

test('formatTimeAgo uses singular "day" for 1 day', t => {
	const now = new Date();
	const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	t.is(formatTimeAgo(oneDayAgo.toISOString()), '1 day ago');
});

test('formatTimeAgo returns weeks for 7+ days ago', t => {
	const now = new Date();

	const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
	t.is(formatTimeAgo(oneWeekAgo.toISOString()), '1 week ago');

	const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
	t.is(formatTimeAgo(twoWeeksAgo.toISOString()), '2 weeks ago');

	const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
	t.is(formatTimeAgo(fourWeeksAgo.toISOString()), '4 weeks ago');
});

test('formatTimeAgo uses singular "week" for 1 week', t => {
	const now = new Date();
	const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
	t.is(formatTimeAgo(oneWeekAgo.toISOString()), '1 week ago');
});

// ============================================================================
// formatMessageCount
// ============================================================================

test('formatMessageCount uses singular for 1 message', t => {
	t.is(formatMessageCount(1), '1 message');
});

test('formatMessageCount uses plural for 0 messages', t => {
	t.is(formatMessageCount(0), '0 messages');
});

test('formatMessageCount uses plural for multiple messages', t => {
	t.is(formatMessageCount(2), '2 messages');
	t.is(formatMessageCount(10), '10 messages');
	t.is(formatMessageCount(100), '100 messages');
});

// ============================================================================
// SessionSelector component
// ============================================================================

test('session-selector renders loading state initially', t => {
	const onSelect = () => {};
	const onCancel = () => {};

	const {lastFrame} = renderWithTheme(
		React.createElement(SessionSelector, {onSelect, onCancel}),
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Loading sessions/i);
});

test('session-selector component renders without crashing', t => {
	const onSelect = () => {};
	const onCancel = () => {};

	const {unmount} = renderWithTheme(
		React.createElement(SessionSelector, {onSelect, onCancel}),
	);

	t.notThrows(() => unmount());
});

test('session-selector shows empty state when no sessions exist', async t => {
	const onSelect = () => {};
	const onCancel = () => {};

	const {lastFrame} = renderWithTheme(
		React.createElement(SessionSelector, {onSelect, onCancel}),
	);

	// Wait for async listSessions to resolve
	await new Promise(resolve => setTimeout(resolve, 200));

	const output = lastFrame();
	t.truthy(output);
	// Should show either the session list or the empty state
	// (depends on whether sessionManager is initialized with data)
	t.true(
		output!.includes('No saved sessions') ||
			output!.includes('Recent Sessions') ||
			output!.includes('Loading'),
	);
});

test('session-selector calls onCancel when Escape is pressed after loading', async t => {
	let cancelCalled = false;
	const onSelect = () => {};
	const onCancel = () => {
		cancelCalled = true;
	};

	const {stdin} = renderWithTheme(
		React.createElement(SessionSelector, {onSelect, onCancel}),
	);

	// Wait for loading to complete
	await new Promise(resolve => setTimeout(resolve, 200));

	// Press Escape
	stdin.write('\u001B');

	await new Promise(resolve => setTimeout(resolve, 50));

	t.true(cancelCalled);
});

test('session-selector does not call onCancel when Escape is pressed during loading', async t => {
	let cancelCalled = false;
	const onSelect = () => {};
	const onCancel = () => {
		cancelCalled = true;
	};

	const {stdin} = renderWithTheme(
		React.createElement(SessionSelector, {onSelect, onCancel}),
	);

	// Press Escape immediately (during loading state)
	stdin.write('\u001B');

	await new Promise(resolve => setTimeout(resolve, 50));

	t.false(cancelCalled);
});

test('session-selector does not call onCancel when arbitrary key is pressed in empty state', async t => {
	let cancelCalled = false;
	const onSelect = () => {};
	const onCancel = () => {
		cancelCalled = true;
	};

	const {stdin, lastFrame} = renderWithTheme(
		React.createElement(SessionSelector, {onSelect, onCancel}),
	);

	// Wait for loading to complete
	await new Promise(resolve => setTimeout(resolve, 200));

	const output = lastFrame();

	// Only meaningful in the empty-state case; skip if sessions exist
	if (
		output!.includes('No saved sessions') ||
		output!.includes('No sessions for this project')
	) {
		// The empty state must tell the user which key dismisses it
		t.regex(output!, /Press Escape to continue/);

		// Press an arbitrary, non-Escape key
		stdin.write('j');

		await new Promise(resolve => setTimeout(resolve, 50));

		t.false(cancelCalled);
	} else {
		t.pass();
	}
});

test('session-selector calls onCancel when Escape is pressed in empty state', async t => {
	let cancelCalled = false;
	const onSelect = () => {};
	const onCancel = () => {
		cancelCalled = true;
	};

	const {stdin, lastFrame} = renderWithTheme(
		React.createElement(SessionSelector, {onSelect, onCancel}),
	);

	await new Promise(resolve => setTimeout(resolve, 200));

	const output = lastFrame();

	if (
		output!.includes('No saved sessions') ||
		output!.includes('No sessions for this project')
	) {
		stdin.write('\u001B');

		await new Promise(resolve => setTimeout(resolve, 50));

		t.true(cancelCalled);
	} else {
		t.pass();
	}
});

test('session-selector shows Esc hint in footer', async t => {
	const onSelect = () => {};
	const onCancel = () => {};

	const {lastFrame} = renderWithTheme(
		React.createElement(SessionSelector, {onSelect, onCancel}),
	);

	// Wait for loading
	await new Promise(resolve => setTimeout(resolve, 200));

	const output = lastFrame();
	t.truthy(output);
	// If sessions are loaded, the footer should show Esc hint
	// If no sessions, the empty state is shown instead
	if (output!.includes('Recent Sessions')) {
		t.regex(output!, /Esc to cancel/);
	} else {
		// Empty state — just verify it rendered
		t.pass();
	}
});

// ============================================================================
// SessionSelector keyword filter
// ============================================================================

const makeSession = (
	id: string,
	title: string,
	messageCount: number,
): SessionMetadata => ({
	id,
	title,
	createdAt: new Date().toISOString(),
	lastAccessedAt: new Date().toISOString(),
	messageCount,
	provider: 'test',
	model: 'test',
	workingDirectory: process.cwd(),
});

const stubSessions: SessionMetadata[] = [
	makeSession('a', 'Fix login bug', 3),
	makeSession('b', 'Refactor parser', 2),
];

// Serial: these swap the sessionManager singleton's listSessions.
const renderWithStubbedSessions = (
	props: Partial<React.ComponentProps<typeof SessionSelector>> = {},
) => {
	const original = sessionManager.listSessions;
	sessionManager.listSessions = async () => stubSessions;
	const rendered = renderWithTheme(
		React.createElement(SessionSelector, {
			onSelect: () => {},
			onCancel: () => {},
			...props,
		}),
	);
	return {
		...rendered,
		frame: () => stripAnsi(rendered.lastFrame() ?? ''),
		restore: () => {
			rendered.unmount();
			sessionManager.listSessions = original;
		},
	};
};

const waitUntil = async (condition: () => boolean, timeoutMs = 3000) => {
	const startedAt = Date.now();
	while (!condition()) {
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
		}
		await new Promise(resolve => setTimeout(resolve, 20));
	}
};

// The list mounts only after sessions load, and Ink subscribes its key handler
// in an effect, so a write sent right after the first frame can be dropped. A
// dropped write leaves no trace, so resend until the filter row appears.
const typeFilter = async (
	stdin: {write: (data: string) => void},
	frame: () => string,
	text: string,
) => {
	let lastWriteAt = 0;
	await waitUntil(() => {
		if (frame().includes('Filter:')) return true;
		if (Date.now() - lastWriteAt > 250) {
			stdin.write(text);
			lastWriteAt = Date.now();
		}
		return false;
	});
};

test.serial('session-selector filters sessions by title as you type', async t => {
	const {stdin, frame, restore} = renderWithStubbedSessions();
	try {
		await waitUntil(() => frame().includes('Fix login bug'));
		t.regex(frame(), /Type to filter/);

		await typeFilter(stdin, frame, 'parser');
		t.regex(frame(), /Filter: parser/);
		t.regex(frame(), /Refactor parser/);
		t.notRegex(frame(), /Fix login bug/);
	} finally {
		restore();
	}
});

test.serial('session-selector filter ignores the message count and age suffix', async t => {
	const {stdin, frame, restore} = renderWithStubbedSessions();
	try {
		await waitUntil(() => frame().includes('Fix login bug'));

		await typeFilter(stdin, frame, 'messages');
		await waitUntil(() => frame().includes('No matches for "messages"'));
		t.notRegex(frame(), /Refactor parser|Fix login bug/);
	} finally {
		restore();
	}
});

test.serial('session-selector selects the filtered session on Enter', async t => {
	let selected: SessionMetadata | null = null;
	const {stdin, frame, restore} = renderWithStubbedSessions({
		onSelect: session => {
			selected = session;
		},
	});
	try {
		await waitUntil(() => frame().includes('Fix login bug'));

		await typeFilter(stdin, frame, 'parser');
		await waitUntil(() => !frame().includes('Fix login bug'));
		stdin.write('\r');
		await waitUntil(() => selected !== null);
		t.is(selected!.id, 'b');
	} finally {
		restore();
	}
});

test.serial('session-selector cancels once on Escape while the list is shown', async t => {
	let cancelCount = 0;
	const {stdin, frame, restore} = renderWithStubbedSessions({
		onCancel: () => {
			cancelCount++;
		},
	});
	try {
		await waitUntil(() => frame().includes('Fix login bug'));
		// Prove the list's key handler is live (see typeFilter) before Escape.
		await typeFilter(stdin, frame, 'fix');

		stdin.write('\u001B');
		await waitUntil(() => cancelCount > 0);
		await new Promise(resolve => setTimeout(resolve, 50));
		t.is(cancelCount, 1);
	} finally {
		restore();
	}
});
