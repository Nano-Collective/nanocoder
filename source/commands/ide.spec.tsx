import test from 'ava';
import type {CommandContext} from '@/types/index';
import {ideCommand} from './ide';

console.log('\nide.spec.tsx');

test('ideCommand has correct name', t => {
	t.is(ideCommand.name, 'ide');
});

test('ideCommand has a description', t => {
	t.truthy(ideCommand.description);
	t.is(typeof ideCommand.description, 'string');
	t.is(ideCommand.description, 'Connect to an IDE');
});

test('ideCommand opens the IDE picker and hands the prompt back', async t => {
	let opened = 0;
	const context = {
		args: [],
		enterIdeSelectionMode: () => opened++,
	} as unknown as CommandContext;

	const completion = await ideCommand.run(context);

	t.is(opened, 1);
	t.is(completion, 'done');
});
