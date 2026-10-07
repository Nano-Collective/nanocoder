import test from 'ava';
import React from 'react';
import {TIPS} from '@/constants';
import {tipCommand} from './tip';

const metadata = {
	provider: 'test',
	model: 'test',
	tokens: 0,
	getMessageTokens: () => 0,
};

async function runTip(args: string[] = []): Promise<string> {
	const result = await tipCommand.handler(args, [], metadata);

	if (!React.isValidElement(result)) {
		throw new Error('/tip did not return an element');
	}

	return (result as React.ReactElement<{message: string}>).props.message;
}

test('tipCommand has the expected metadata', t => {
	t.is(tipCommand.name, 'tip');
	t.is(tipCommand.description, 'Show a random Nanocoder usage tip');
});

test('tipCommand returns a tip from the shared catalogue', async t => {
	const message = await runTip();

	t.true(message.startsWith('Tip: '));
	t.true(TIPS.some(tip => message === `Tip: ${tip}`));
});

test('tipCommand does not repeat the tip it just showed', async t => {
	const first = await runTip();
	const second = await runTip();

	t.not(first, second);
});

test('tipCommand filters the catalogue by its argument', async t => {
	const message = await runTip(['ctrl+j']);

	t.is(
		message,
		'Tip: Press Ctrl+J to add a new line without sending your prompt.',
	);
});

test('tipCommand joins multi-word arguments into one query', async t => {
	const message = await runTip(['new', 'line']);

	t.is(
		message,
		'Tip: Press Ctrl+J to add a new line without sending your prompt.',
	);
});

test('tipCommand reports when nothing matches instead of picking at random', async t => {
	const message = await runTip(['quantum']);

	t.is(
		message,
		'No tip mentions "quantum". Run /tip on its own for a random one.',
	);
});
