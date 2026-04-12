import test from 'ava';
import React from 'react';
import {creditsCommand} from './credits';

test('creditsCommand has correct name and description', (t) => {
	t.is(creditsCommand.name, 'credits');
	t.is(
		creditsCommand.description,
		'Show project contributors and dependencies',
	);
});

test('creditsCommand handler returns a valid React element', async (t) => {
	const result = await creditsCommand.handler([], [], {
		provider: 'test',
		model: 'test',
		tokens: 0,
		getMessageTokens: () => 0,
	});
	t.true(React.isValidElement(result));
});
