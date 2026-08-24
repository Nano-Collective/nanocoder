import test from 'ava';
import React from 'react';
import {TIPS} from '@/constants';
import {tipCommand} from './tip';

test('tipCommand has the expected metadata', t => {
	t.is(tipCommand.name, 'tip');
	t.is(tipCommand.description, 'Show a random Nanocoder usage tip');
});

test('tipCommand returns a tip from the shared catalogue', async t => {
	const result = await tipCommand.handler([], [], {
		provider: 'test',
		model: 'test',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	t.true(React.isValidElement(result));
	const message = (result as React.ReactElement<{message: string}>).props.message;
	t.true(message.startsWith('Tip: '));
	t.true(TIPS.some(tip => message === `Tip: ${tip}`));
});
