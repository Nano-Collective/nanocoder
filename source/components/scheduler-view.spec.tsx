import test from 'ava';
import React from 'react';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import {SchedulerView} from './scheduler-view';

void React; // JSX runtime requires React in scope

// ============================================================================
// Helpers
// ============================================================================

const defaultProps = {
	activeJobCount: 2,
	queueLength: 0,
	isProcessing: false,
	currentJobCommand: null,
	developmentMode: 'scheduler' as const,
	contextPercentUsed: null,
	onExit: () => {},
};

// ============================================================================
// Component Rendering Tests
// ============================================================================

test('SchedulerView renders without crashing', t => {
	const {unmount} = renderWithTheme(<SchedulerView {...defaultProps} />);
	t.notThrows(() => unmount());
});

test('SchedulerView has correct display name', t => {
	t.is(SchedulerView.displayName, 'SchedulerView');
});

test('SchedulerView shows cron job count', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SchedulerView {...defaultProps} activeJobCount={3} />,
	);
	const output = lastFrame();
	t.regex(output!, /3 cron jobs registered/);
	unmount();
});

test('SchedulerView uses singular for 1 cron job', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SchedulerView {...defaultProps} activeJobCount={1} />,
	);
	const output = lastFrame();
	t.regex(output!, /1 cron job registered/);
	t.notRegex(output!, /1 cron jobs/);
	unmount();
});

test('SchedulerView shows escape hint', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SchedulerView {...defaultProps} />,
	);
	const output = lastFrame();
	t.regex(output!, /Press Escape to exit scheduler mode/);
	unmount();
});

// ============================================================================
// Idle State Tests
// ============================================================================

test('SchedulerView shows waiting message when not processing', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SchedulerView {...defaultProps} isProcessing={false} />,
	);
	const output = lastFrame();
	t.regex(output!, /Waiting for next scheduled job/);
	unmount();
});

test('SchedulerView does not show running command when idle', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SchedulerView {...defaultProps} isProcessing={false} currentJobCommand="test.md" />,
	);
	const output = lastFrame();
	t.notRegex(output!, /Running:/);
	unmount();
});

// ============================================================================
// Processing State Tests
// ============================================================================

test('SchedulerView shows running command when processing', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SchedulerView
			{...defaultProps}
			isProcessing={true}
			currentJobCommand="deps-update.md"
		/>,
	);
	const output = lastFrame();
	t.regex(output!, /Running: deps-update\.md/);
	unmount();
});

test('SchedulerView shows queue count when processing with queued items', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SchedulerView
			{...defaultProps}
			isProcessing={true}
			currentJobCommand="test.md"
			queueLength={3}
		/>,
	);
	const output = lastFrame();
	t.regex(output!, /3 queued/);
	unmount();
});

test('SchedulerView hides queue count when queue is empty', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SchedulerView
			{...defaultProps}
			isProcessing={true}
			currentJobCommand="test.md"
			queueLength={0}
		/>,
	);
	const output = lastFrame();
	t.notRegex(output!, /queued/);
	unmount();
});

test('SchedulerView hides waiting message when processing', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SchedulerView
			{...defaultProps}
			isProcessing={true}
			currentJobCommand="test.md"
		/>,
	);
	const output = lastFrame();
	t.notRegex(output!, /Waiting for next scheduled job/);
	unmount();
});

// ============================================================================
// Development Mode Indicator Tests
// ============================================================================

test('SchedulerView shows scheduler mode indicator', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SchedulerView {...defaultProps} developmentMode="scheduler" />,
	);
	const output = lastFrame();
	t.regex(output!, /scheduler mode on/);
	unmount();
});

test('SchedulerView shows context percentage when provided', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<SchedulerView {...defaultProps} contextPercentUsed={42} />,
	);
	const output = lastFrame();
	t.regex(output!, /ctx: 42%/);
	unmount();
});
