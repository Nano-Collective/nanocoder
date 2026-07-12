import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme';
import PlanReviewPrompt from './plan-review-prompt';

console.log(`\nplan-review-prompt.spec.tsx – ${React.version}`);

// ============================================================================
// Test Helpers
// ============================================================================

const ARROW_DOWN = '[B';
const ESCAPE = '';

function makeHandlers() {
	const calls = {proceed: 0, modify: 0, askMore: 0, dismiss: 0};
	return {
		calls,
		props: {
			onProceed: () => {
				calls.proceed++;
			},
			onModify: () => {
				calls.modify++;
			},
			onAskMore: () => {
				calls.askMore++;
			},
			onDismiss: () => {
				calls.dismiss++;
			},
		},
	};
}

const tick = () => new Promise(resolve => setTimeout(resolve, 30));

// ============================================================================
// Tests
// ============================================================================

test('renders the header and the three action options', t => {
	const {props} = makeHandlers();
	const {lastFrame, unmount} = renderWithTheme(<PlanReviewPrompt {...props} />);
	const output = lastFrame()!;
	t.regex(output, /Plan ready/);
	t.regex(output, /Proceed/);
	t.regex(output, /Modify/);
	t.regex(output, /Ask more/);
	unmount();
});

test('shows the highlighted option description, and updates on navigation', async t => {
	const {props} = makeHandlers();
	const {stdin, lastFrame, unmount} = renderWithTheme(
		<PlanReviewPrompt {...props} />,
	);
	await tick();
	// Proceed is highlighted by default.
	t.regex(lastFrame()!, /execute the plan/);
	// Arrow down to Modify — its description should now show.
	stdin.write(ARROW_DOWN);
	await tick();
	t.regex(lastFrame()!, /re-plan/);
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
	t.is(calls.askMore, 0);
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

test('Escape dismisses', async t => {
	const {calls, props} = makeHandlers();
	const {stdin, unmount} = renderWithTheme(<PlanReviewPrompt {...props} />);
	await tick();
	stdin.write(ESCAPE);
	await tick();
	t.is(calls.dismiss, 1);
	unmount();
});
