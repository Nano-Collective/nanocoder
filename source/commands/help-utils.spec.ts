import test from 'ava';
import type {Command} from '@/types/index';
import {
	findHelpCommand,
	getCommandHelpDetails,
	groupHelpCommands,
} from './help-utils';

function command(name: string, description = `Description for ${name}`): Command {
	return {
		name,
		description,
		handler: async () => {},
	};
}

test('findHelpCommand resolves command names case-insensitively', t => {
	const commit = command('commit');

	t.is(findHelpCommand([commit], 'COMMIT'), commit);
	t.is(findHelpCommand([commit], '/commit'), commit);
});

test('findHelpCommand resolves documented aliases', t => {
	const resume = command('resume');

	t.is(findHelpCommand([resume], 'sessions'), resume);
	t.is(findHelpCommand([resume], 'history'), resume);
	t.is(findHelpCommand([resume], 'missing'), undefined);
});

test('getCommandHelpDetails exposes usage, options, aliases, and examples', t => {
	const details = getCommandHelpDetails(command('tasks'));

	t.is(details.category, 'Session & Workflow');
	t.is(details.usage, '/tasks [add <title>|remove|rm <number>|clear]');
	t.deepEqual(details.options, [
		'add <title>',
		'remove|rm <number>',
		'clear',
	]);
	t.deepEqual(details.examples, [
		'/tasks',
		'/tasks add review pull request',
		'/tasks remove 2',
	]);
});

test('getCommandHelpDetails documents supported command syntax', t => {
	const agents = getCommandHelpDetails(command('agents'));
	const checkpoint = getCommandHelpDetails(command('checkpoint'));
	const memory = getCommandHelpDetails(command('memory'));
	const compact = getCommandHelpDetails(command('compact'));
	const init = getCommandHelpDetails(command('init'));
	const skills = getCommandHelpDetails(command('skills'));

	t.is(agents.usage, '/agents [show <name>|copy <name>|create <name>]');
	t.true(agents.options?.includes('copy <name>'));
	t.true(checkpoint.options?.includes('delete|remove|rm <name>'));
	t.true(memory.options?.includes('accept <n>'));
	t.true(compact.options?.includes('--threshold <50-95>'));
	t.true(init.options?.includes('--preset <react|nextjs|rust>'));
	t.true(skills.options?.includes('promote <name> [--force] [--move]'));
	t.true(skills.examples?.includes('/skills check pr-reviewer'));
	t.is(getCommandHelpDetails(command('commands')).aliases, undefined);
});

test('groupHelpCommands orders categories and commands deterministically', t => {
	const commands = [
		command('z-command'),
		command('tools'),
		command('clear'),
		command('agents'),
		command('commit'),
	];

	t.deepEqual(
		groupHelpCommands(commands).map(group => ({
			category: group.category,
			commands: group.commands.map(item => item.name),
		})),
		[
			{category: 'Session & Workflow', commands: ['clear']},
			{category: 'Coding & Agent Tools', commands: ['agents', 'commit', 'tools']},
			{category: 'Other', commands: ['z-command']},
		],
	);
});
