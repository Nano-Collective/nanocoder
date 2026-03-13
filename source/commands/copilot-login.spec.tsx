import test from 'ava';
import {copilotLoginCommand} from './copilot-login-command.js';

test('copilot-login command is registered with correct name', t => {
	t.is(copilotLoginCommand.name, 'copilot-login');
});

test('copilot-login command has a description', t => {
	t.truthy(copilotLoginCommand.description);
});

test('copilot-login command handler returns undefined (handled via live component)', async t => {
	const result = await copilotLoginCommand.handler([], [], {} as any);
	t.is(result, undefined);
});
