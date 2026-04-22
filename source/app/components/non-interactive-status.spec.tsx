import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../../test-utils/render-with-theme';
import {NonInteractiveStatus} from './non-interactive-status';

test('NonInteractiveStatus shows completion line when message is null', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<NonInteractiveStatus message={null} />,
	);
	const output = lastFrame();
	t.truthy(output);
	// marginLeft={-1} in the component cuts off the first character in tests
	t.regex(output!, /ompleted.*Exiting/);
	unmount();
});

test('NonInteractiveStatus renders the supplied message with a spinner', t => {
	const {lastFrame, unmount} = renderWithTheme(
		<NonInteractiveStatus message="Waiting for chat to complete..." />,
	);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Waiting for chat to complete/);
	t.notRegex(output!, /Completed/);
	unmount();
});
