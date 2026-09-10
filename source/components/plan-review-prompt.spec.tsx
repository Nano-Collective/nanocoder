import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme';
import PlanReviewPrompt, {createTerminalFileLink} from './plan-review-prompt';

console.log(`\nplan-review-prompt.spec.tsx – ${React.version}`);

// ============================================================================
// Test Helpers
// ============================================================================

const ARROW_DOWN = '[B';
const ESCAPE = '';

function makeHandlers() {
	const calls = {proceed: 0, modify: 0};
	return {
		calls,
		props: {
			onProceed: () => {
				calls.proceed++;
			},
			onModify: () => {
				calls.modify++;
			},
		},
	};
}

const tick = () => new Promise(resolve => setTimeout(resolve, 30));

// ============================================================================
// Tests
// ============================================================================

test('renders only the explicit execute-or-revise decisions', t => {
	const {props} = makeHandlers();
	const {lastFrame, unmount} = renderWithTheme(<PlanReviewPrompt {...props} />);
	const output = lastFrame()!;
	t.regex(output, /Plan ready/);
	t.regex(output, /Yes, execute this plan/);
	t.regex(output, /No, tell Nanocoder what to change/);
	t.regex(output, /Ask me clarifying questions/);
	// The highlighted option's own description carries the mode consequence,
	// so there is no duplicated summary line above it.
	t.regex(output, /Exit Plan Mode and begin implementation/);
	t.notRegex(output, /Executing exits Plan Mode/);
	unmount();
});

test('shows the persisted plan path and terminal open hint', t => {
	const {props} = makeHandlers();
	const artifactPath = '/tmp/implementation_plan.md';
	const {lastFrame, unmount} = renderWithTheme(
		<PlanReviewPrompt {...props} {...({artifactPath} as never)} />,
	);
	const output = lastFrame()!;

	t.regex(output, /Saved plan/);
	t.regex(output, /implementation_plan\.md/);
	t.regex(output, /Cmd\/Ctrl\+click to open/);
	// The raw path stays as the copy/paste and non-OSC-8 fallback.
	t.regex(output, /\/tmp\/implementation_plan\.md/);
	unmount();
});

test('creates an OSC 8 file hyperlink with a short non-wrapping label', t => {
	const link = createTerminalFileLink('/tmp/implementation plan.md');

	t.true(
		link.includes(
			'\u001B]8;;file:///tmp/implementation%20plan.md\u0007',
		),
	);
	t.true(link.includes('Open implementation plan.md'));
	t.true(link.endsWith('\u001B]8;;\u0007'));
});

test('shows the highlighted option description, and updates on navigation', async t => {
	const {props} = makeHandlers();
	const {stdin, lastFrame, unmount} = renderWithTheme(
		<PlanReviewPrompt {...props} />,
	);
	await tick();
	// Execute is highlighted by default.
	t.regex(lastFrame()!, /Exit Plan Mode/);
	// Arrow down to request changes — its description should now show.
	stdin.write(ARROW_DOWN);
	await tick();
	t.regex(lastFrame()!, /Stay in Plan Mode/);
	unmount();
});

test('Enter selects Proceed (the first option)', async t => {
	const {calls, props} = makeHandlers();
	const {stdin, unmount} = renderWithTheme(<PlanReviewPrompt {...props} />);
	await tick();
	stdin.write('\r');
	await tick();
	t.is(calls.proceed, 1);
	t.is(calls.modify, 0);
	unmount();
});

test('arrow-down then Enter selects Modify', async t => {
	const {calls, props} = makeHandlers();
	const {stdin, unmount} = renderWithTheme(<PlanReviewPrompt {...props} />);
	await tick();
	stdin.write(ARROW_DOWN);
	await tick();
	stdin.write('\r');
	await tick();
	t.is(calls.modify, 1);
	t.is(calls.proceed, 0);
	unmount();
});

test('Escape takes the revise path instead of ambiguously dismissing', async t => {
	const {calls, props} = makeHandlers();
	const {stdin, unmount} = renderWithTheme(<PlanReviewPrompt {...props} />);
	await tick();
	stdin.write(ESCAPE);
	await tick();
	t.is(calls.modify, 1);
	unmount();
});
