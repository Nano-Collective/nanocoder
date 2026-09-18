import test from 'ava';
import React from 'react';
import type {Command, Message} from '@/types/index';
import {renderWithTheme} from '@/test-utils/render-with-theme';
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

test('helpCommand resolves aliases from lazy commands', async t => {
	const resume = command('resume');
	commandRegistry.registerLazy({
		name: resume.name,
		description: resume.description,
		load: async () => resume,
	});

	const result = await helpCommand.handler(['sessions'], messages, metadata);

	t.true(React.isValidElement(result));
	const selectedCommand = (result as React.ReactElement<{
		selectedCommand?: Command;
	}>).props.selectedCommand;
	t.is(selectedCommand?.name, resume.name);
	t.is(selectedCommand?.description, resume.description);
});

test('helpCommand renders categorized command list', async t => {
	commandRegistry.register([
		command('commit'),
		command('clear'),
		command('z-command'),
	]);

	const result = await helpCommand.handler([], messages, metadata);
	const output = renderWithTheme(result as React.ReactElement).lastFrame();

	t.truthy(output);
	t.regex(output!, /Session & Workflow:/);
	t.regex(output!, /Coding & Agent Tools:/);
	t.regex(output!, /Other:/);
	t.regex(output!, /\/clear - Description for clear/);
	t.regex(output!, /\/commit - Description for commit/);
	t.regex(output!, /\/z-command - Description for z-command/);
});

test('helpCommand renders an empty command list', async t => {
	const result = await helpCommand.handler([], messages, metadata);
	const output = renderWithTheme(result as React.ReactElement).lastFrame();

	t.truthy(output);
	t.regex(output!, /No commands available\./);
});

test('helpCommand renders command options and examples', async t => {
	commandRegistry.register(command('tasks'));

	const result = await helpCommand.handler(['tasks'], messages, metadata);
	const output = renderWithTheme(result as React.ReactElement).lastFrame();

	t.truthy(output);
	t.regex(output!, /Command: \/tasks/);
	t.regex(output!, /Usage: \/tasks \[add <title>\|remove\|rm <number>\|clear\]/);
	t.regex(output!, /Options & subcommands:/);
	t.regex(output!, /• add <title>/);
	t.regex(output!, /Examples:/);
	t.regex(output!, /• \/tasks remove 2/);
});

test('helpCommand renders command aliases', async t => {
	commandRegistry.register(command('resume'));

	const result = await helpCommand.handler(['resume'], messages, metadata);
	const output = renderWithTheme(result as React.ReactElement).lastFrame();

	t.truthy(output);
	t.regex(output!, /Aliases: \/sessions, \/history/);
});

test('helpCommand reports unknown commands', async t => {
	const result = await helpCommand.handler(['missing'], messages, metadata);

	t.true(React.isValidElement(result));
	t.is(
		(result as React.ReactElement<{message: string}>).props.message,
		'Unknown command: missing. Type /help to see available commands.',
	);
});
