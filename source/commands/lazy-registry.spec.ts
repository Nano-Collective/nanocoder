import test from 'ava';
import {getCommandHelpDetails} from './help-utils.js';
import {lazyCommands} from './lazy-registry.js';

// The registry entry is what the slash menu and /help show (the proxy never
// reads the module's copy), but the module keeps its own copy too. They had
// drifted for /privacy, /voice and /review; this loads every module and keeps
// the two in step.

test('every registry entry matches the command module it loads', async t => {
	for (const entry of lazyCommands) {
		const command = await entry.load();
		t.is(command.name, entry.name, `${entry.name}: name`);
		t.is(
			command.description,
			entry.description,
			`/${entry.name}: registry and module descriptions differ`,
		);
		t.is(
			command.progressLabel,
			entry.progressLabel,
			`/${entry.name}: progressLabel`,
		);
		t.is(
			command.echoInvocation,
			entry.echoInvocation,
			`/${entry.name}: echoInvocation`,
		);
	}
});

test('every built-in command is filed under a /help category', t => {
	for (const entry of lazyCommands) {
		const {category} = getCommandHelpDetails({
			name: entry.name,
			description: entry.description,
			handler: async () => {},
		});
		t.not(category, 'Other', `/${entry.name} has no /help category`);
	}
});

test('registry command names are unique', t => {
	const names = lazyCommands.map(entry => entry.name);
	t.is(new Set(names).size, names.length);
});
