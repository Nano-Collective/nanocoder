import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme';
import PlanReviewPrompt from './plan-review-prompt';

console.log('\nplan-review-prompt.spec.tsx');

// ============================================================================
// Rendering
// ============================================================================

test('renders plan ready header', t => {
	const {lastFrame} = renderWithTheme(
		<PlanReviewPrompt
			onProceed={() => {}}
			onModify={() => {}}
			onAskMore={() => {}}
			onDismiss={() => {}}
		/>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Plan ready/);
});

test('renders all three action options', t => {
	const {lastFrame} = renderWithTheme(
		<PlanReviewPrompt
			onProceed={() => {}}
			onModify={() => {}}
			onAskMore={() => {}}
			onDismiss={() => {}}
		/>,
	);
	const output = lastFrame();
	t.regex(output!, /\[p\]/);
	t.regex(output!, /Proceed/);
	t.regex(output!, /\[m\]/);
	t.regex(output!, /Modify/);
	t.regex(output!, /\[a\]/);
	t.regex(output!, /Ask more/);
	t.regex(output!, /Esc/i);
});

// ============================================================================
// Keyboard interaction
// ============================================================================

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 20));

test('pressing p calls onProceed', async t => {
	let proceedCalled = false;
	const {stdin} = renderWithTheme(
		<PlanReviewPrompt
			onProceed={() => {
				proceedCalled = true;
			}}
			onModify={() => {}}
			onAskMore={() => {}}
			onDismiss={() => {}}
		/>,
	);
	stdin.write('p');
	await tick();
	t.true(proceedCalled);
});

test('pressing m calls onModify', async t => {
	let modifyCalled = false;
	const {stdin} = renderWithTheme(
		<PlanReviewPrompt
			onProceed={() => {}}
			onModify={() => {
				modifyCalled = true;
			}}
			onAskMore={() => {}}
			onDismiss={() => {}}
		/>,
	);
	stdin.write('m');
	await tick();
	t.true(modifyCalled);
});

test('pressing a calls onAskMore', async t => {
	let askMoreCalled = false;
	const {stdin} = renderWithTheme(
		<PlanReviewPrompt
			onProceed={() => {}}
			onModify={() => {}}
			onAskMore={() => {
				askMoreCalled = true;
			}}
			onDismiss={() => {}}
		/>,
	);
	stdin.write('a');
	await tick();
	t.true(askMoreCalled);
});

test('pressing Escape calls onDismiss', async t => {
	let dismissCalled = false;
	const {stdin} = renderWithTheme(
		<PlanReviewPrompt
			onProceed={() => {}}
			onModify={() => {}}
			onAskMore={() => {}}
			onDismiss={() => {
				dismissCalled = true;
			}}
		/>,
	);
	stdin.write('\x1B'); // ESC
	await tick();
	t.true(dismissCalled);
});
