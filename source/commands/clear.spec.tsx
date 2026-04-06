import test from 'ava';
import {clearCommand} from './clear';

test('clearCommand has correct name and description', t => {
	t.is(clearCommand.name, 'clear');
	t.is(
		clearCommand.description,
		'Clear the chat history, model context, and tasks',
	);
});

test('clearCommand handler returns undefined (handled by special command)', async t => {
	const result = await clearCommand.handler([]);
	t.is(result, undefined);
});
