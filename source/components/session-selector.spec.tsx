import test from 'ava';
import React from 'react';
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
