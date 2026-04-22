import test from 'ava';
import {Text} from 'ink';
import React from 'react';
import {renderWithTheme} from '../../test-utils/render-with-theme';
import {NonInteractiveShell} from './non-interactive-shell';

test('NonInteractiveShell renders the transcript and status line', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<NonInteractiveShell
			startChat={true}
			staticComponents={[<Text key="s">boot summary</Text>]}
			queuedComponents={[<Text key="q">assistant reply</Text>]}
			statusMessage="Waiting for chat to complete..."
		/>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /boot summary/);
	t.regex(output!, /assistant reply/);
	t.regex(output!, /Waiting for chat to complete/);
	unmount();
});

test('NonInteractiveShell renders completion line when status is null', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<NonInteractiveShell
			startChat={true}
			staticComponents={[]}
			queuedComponents={[<Text key="q">final answer</Text>]}
			statusMessage={null}
		/>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /final answer/);
	t.regex(output!, /ompleted.*Exiting/);
	unmount();
});

test('NonInteractiveShell renders a live component below the transcript', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<NonInteractiveShell
			startChat={true}
			staticComponents={[]}
			queuedComponents={[]}
			liveComponent={<Text>streaming tokens</Text>}
			statusMessage="Waiting for chat to complete..."
		/>,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /streaming tokens/);
	unmount();
});
