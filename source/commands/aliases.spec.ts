import test from 'ava';
import {CommandRegistry} from '@/commands';
import type {Command} from '@/types/index';
import {
	COMMAND_ALIASES,
	expandCommandAlias,
	findCommandAlias,
} from './aliases.js';
import {
	findHelpCommand,
	getCommandHelpDetails,
	groupHelpCommands,
} from './help-utils.js';
import {lazyCommands} from './lazy-registry.js';

const registeredNames = new Set(lazyCommands.map(entry => entry.name));

function registryWithBuiltIns(): CommandRegistry {
	const registry = new CommandRegistry();
	registry.registerLazy(lazyCommands);
	return registry;
}

test('every old command name is still an alias', t => {
	for (const name of [
		'quit',
		'remember',
		'codex-login',
		'copilot-login',
		'model-database',
		'schedule',
		'sessions',
		'history',
	]) {
		t.truthy(findCommandAlias(name), `/${name} no longer resolves`);
	}
});

test('every alias points at a registered command and is not one itself', t => {
	for (const alias of COMMAND_ALIASES) {
		t.true(
			registeredNames.has(alias.target),
			`/${alias.name} -> /${alias.target}, which is not registered`,
		);
		t.false(
			registeredNames.has(alias.name),
			`/${alias.name} is registered, so it would show in /help`,
		);
	}
});

test('expandCommandAlias inserts the target and its subcommand', t => {
	t.is(expandCommandAlias('/quit'), '/exit');
	t.is(expandCommandAlias('/remember use tabs'), '/memory add use tabs');
	t.is(expandCommandAlias('/codex-login'), '/login codex');
	t.is(expandCommandAlias('/copilot-login Work'), '/login copilot Work');
	t.is(expandCommandAlias('/model-database'), '/model browse');
	t.is(expandCommandAlias('/schedule'), '/skills schedule');
});

test('expandCommandAlias keeps the rest of the message byte-for-byte', t => {
	t.is(
		expandCommandAlias('/remember  two  spaces\nand a newline'),
		'/memory add  two  spaces\nand a newline',
	);
});

test('expandCommandAlias leaves other input alone', t => {
	for (const message of ['/memory add x', '/help', '/quitter', 'quit', '/']) {
		t.is(expandCommandAlias(message), message);
	}
});

test('aliases are not offered as completions while typing', t => {
	const registry = registryWithBuiltIns();
	const all = registry.getCompletions('');
	for (const alias of COMMAND_ALIASES) {
		t.false(all.includes(alias.name), `/${alias.name} listed`);
	}
	t.false(registry.getCompletions('qui').includes('quit'));
	t.false(registry.getCompletions('rem').includes('remember'));
	t.true(registry.getCompletions('log').includes('login'));
});

test('an alias typed in full completes to itself so Enter submits it', t => {
	const registry = registryWithBuiltIns();
	for (const alias of COMMAND_ALIASES) {
		t.is(registry.getCompletions(alias.name)[0], alias.name);
	}
});

function proxies(): Command[] {
	return registryWithBuiltIns().getAll();
}

test('/help lists neither aliases nor hidden commands', t => {
	const listed = groupHelpCommands(proxies()).flatMap(group =>
		group.commands.map(command => command.name),
	);
	for (const alias of COMMAND_ALIASES) {
		t.false(listed.includes(alias.name));
	}
	for (const hidden of ['tip', 'credits', 'privacy']) {
		t.false(listed.includes(hidden), `/${hidden} is listed`);
	}
	t.true(listed.includes('exit'));
	t.true(listed.includes('login'));
});

test('hidden commands still complete and have their own /help page', t => {
	const registry = registryWithBuiltIns();
	for (const hidden of ['tip', 'credits', 'privacy']) {
		t.true(registry.getCompletions(hidden).includes(hidden));
		t.is(findHelpCommand(proxies(), hidden)?.name, hidden);
	}
});

test('/help <old name> opens the command it now runs', t => {
	const commands = proxies();
	t.is(findHelpCommand(commands, 'quit')?.name, 'exit');
	t.is(findHelpCommand(commands, '/remember')?.name, 'memory');
	t.is(findHelpCommand(commands, 'codex-login')?.name, 'login');
	t.is(findHelpCommand(commands, 'model-database')?.name, 'model');
	t.is(findHelpCommand(commands, 'schedule')?.name, 'skills');
	t.is(findHelpCommand(commands, 'sessions')?.name, 'resume');
	t.is(findHelpCommand(commands, 'history')?.name, 'resume');
});

test('a command help page lists the old names that run it', t => {
	const byName = new Map(proxies().map(command => [command.name, command]));
	t.deepEqual(getCommandHelpDetails(byName.get('exit')!).aliases, ['quit']);
	t.deepEqual(getCommandHelpDetails(byName.get('login')!).aliases, [
		'codex-login (= /login codex)',
		'copilot-login (= /login copilot)',
	]);
	t.deepEqual(getCommandHelpDetails(byName.get('resume')!).aliases, [
		'sessions',
		'history',
	]);
});
