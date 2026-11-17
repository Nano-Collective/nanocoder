import test from 'ava';
import type {Message} from '@/types/core';
import {filterModelFacing, isModelFacing} from './message-visibility';

test('isModelFacing treats an unmarked message as model-facing', t => {
	t.true(isModelFacing({role: 'user', content: 'hi'}));
	t.true(isModelFacing({role: 'assistant', content: 'hi', displayOnly: false}));
});

test('isModelFacing rejects a display-only message', t => {
	t.false(
		isModelFacing({
			role: 'assistant',
			content: '_Cancelled by user._',
			displayOnly: true,
		}),
	);
});

test('filterModelFacing keeps order and drops only the marked messages', t => {
	const messages: Message[] = [
		{role: 'user', content: 'go'},
		{role: 'assistant', content: '**Error:** boom', displayOnly: true},
		{role: 'assistant', content: 'Done.'},
	];

	t.deepEqual(filterModelFacing(messages), [messages[0], messages[2]]);
});

test('filterModelFacing does not mutate its input', t => {
	const messages: Message[] = [
		{role: 'user', content: 'go'},
		{role: 'assistant', content: 'notice', displayOnly: true},
	];

	filterModelFacing(messages);
	t.is(messages.length, 2);
});
