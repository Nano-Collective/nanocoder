import test from 'ava';
import React from 'react';
import type {Command, Message} from '@/types/index';
import {commandRegistry} from '@/commands';
import {helpCommand} from './help';

function command(name: string): Command {
	return {
		name,
		description: `Description for ${name}`,
		handler: async () => {},
	};
}

const messages: Message[] = [];
const metadata = {
	provider: 'test',
	model: 'test-model',
	tokens: 0,
	getMessageTokens: () => 0,
};

test.beforeEach(() => {
	const registry = commandRegistry as unknown as {
		commands: Map<string, Command>;
		lazyEntries: Map<string, unknown>;
	};
	registry.commands.clear();
	registry.lazyEntries.clear();
});

test('helpCommand renders the requested command details', async t => {
	const commit = command('commit');
	commandRegistry.register(commit);

	const result = await helpCommand.handler(['commit'], messages, metadata);

	t.true(React.isValidElement(result));
	t.is(
		(result as React.ReactElement<{selectedCommand?: Command}>).props
			.selectedCommand,
		commit,
	);
});

test('helpCommand resolves command aliases', async t => {
	const resume = command('resume');
	commandRegistry.register(resume);

	const result = await helpCommand.handler(['sessions'], messages, metadata);

	t.true(React.isValidElement(result));
	t.is(
		(result as React.ReactElement<{selectedCommand?: Command}>).props
			.selectedCommand,
		resume,
	);
});

test('helpCommand reports unknown commands', async t => {
	const result = await helpCommand.handler(['missing'], messages, metadata);

	t.true(React.isValidElement(result));
	t.is(
		(result as React.ReactElement<{message: string}>).props.message,
		'Unknown command: missing. Type /help to see available commands.',
	);
});
