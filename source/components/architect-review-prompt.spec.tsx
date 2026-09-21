import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme';
import ArchitectReviewPrompt from './architect-review-prompt';

const tick = () => new Promise(resolve => setTimeout(resolve, 30));

const ESC = '';
const DOWN = '[B';

interface Calls {
	keep: number;
	revert: number;
	revise: string[];
}

function renderPrompt() {
	const calls: Calls = {keep: 0, revert: 0, revise: []};

	const rendered = renderWithTheme(
		<ArchitectReviewPrompt
			onKeep={() => {
				calls.keep++;
			}}
			onRevert={() => {
				calls.revert++;
			}}
			onRevertAndRevise={instructions => {
				calls.revise.push(instructions);
			}}
			filesChanged={['test.txt']}
			filesMissing={[]}
		/>,
	);

	return {...rendered, calls};
}

test('Keep leaves changes in place', async t => {
	const {stdin, unmount, calls} = renderPrompt();

	await tick();
	stdin.write('\r');
	await tick();

	t.is(calls.keep, 1);
	t.is(calls.revert, 0);
	t.deepEqual(calls.revise, []);

	unmount();
});

test('Revert is reachable from the second option', async t => {
	const {stdin, unmount, calls} = renderPrompt();

	await tick();
	stdin.write(DOWN);
	await tick();
	stdin.write('\r');
	await tick();

	t.is(calls.revert, 1);
	t.is(calls.keep, 0);

	unmount();
});

// Escape is the reflex "get me out of here" key. It resolving to revert would
// discard a whole turn on a keypress people make without reading, so it has to
// land on the non-destructive branch — and the footer has to say so.
test('Escape keeps rather than reverting', async t => {
	const {stdin, unmount, calls, lastFrame} = renderPrompt();

	await tick();
	t.true(
		lastFrame()?.includes('Esc to keep'),
		'the footer must describe what Escape actually does',
	);

	stdin.write(ESC);
	await tick();

	t.is(calls.keep, 1, 'Escape keeps');
	t.is(calls.revert, 0, 'Escape must never revert');

	unmount();
});

// The revise box collected instructions that the call site then threw away,
// substituting a fixed string. The component must hand them to the caller.
test('Revert & Revise forwards the instructions the user typed', async t => {
	const {stdin, unmount, calls} = renderPrompt();

	await tick();
	stdin.write(DOWN);
	await tick();
	stdin.write(DOWN);
	await tick();
	stdin.write('\r');
	await tick();

	stdin.write('use a switch instead');
	await tick();
	stdin.write('\r');
	await tick();

	t.deepEqual(calls.revise, ['use a switch instead']);
	t.is(calls.revert, 0, 'revise must not also fire the plain revert path');

	unmount();
});

test('Revise submits nothing when the instructions are blank', async t => {
	const {stdin, unmount, calls} = renderPrompt();

	await tick();
	stdin.write(DOWN);
	await tick();
	stdin.write(DOWN);
	await tick();
	stdin.write('\r');
	await tick();

	stdin.write('   ');
	await tick();
	stdin.write('\r');
	await tick();

	t.deepEqual(calls.revise, []);

	unmount();
});

// Escape inside the revise box backs out to the option list rather than
// resolving the gate, so a user who opens it by mistake is not trapped.
test('Escape in revise mode returns to the options without resolving', async t => {
	const {stdin, unmount, calls} = renderPrompt();

	await tick();
	stdin.write(DOWN);
	await tick();
	stdin.write(DOWN);
	await tick();
	stdin.write('\r');
	await tick();

	stdin.write(ESC);
	await tick();

	t.is(calls.keep, 0);
	t.is(calls.revert, 0);
	t.deepEqual(calls.revise, []);

	unmount();
});
