import test from 'ava';
import {codexLoginCommand} from './codex-login-command';

test('codex-login command is registered with correct name', t => {
	t.is(codexLoginCommand.name, 'codex-login');
});

test('codex-login command has a description', t => {
	t.truthy(codexLoginCommand.description);
	t.truthy(codexLoginCommand.description.length > 0);
});

test('codex-login command handler returns undefined (handled via live component)', async t => {
	const result = await codexLoginCommand.handler(
		[],
		[],
		{} as Parameters<typeof codexLoginCommand.handler>[2],
	);
	t.is(result, undefined);
});
