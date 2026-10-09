import test from 'ava';
import type React from 'react';
import {createStubCommand} from './create-stub-command';

test('stub handler reports that the command needs interactive mode', async t => {
	const command = createStubCommand('compact', 'Compress history');
	const result = await command.handler([], [], {
		provider: 'p',
		model: 'm',
		tokens: 0,
		getMessageTokens: () => 0,
	});
	t.regex(
		(result as React.ReactElement<{message: string}>).props.message,
		/\/compact requires interactive mode/,
	);
});
