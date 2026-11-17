import test from 'ava';
import {createTerminalFileLink} from './terminal-file-link';

test('createTerminalFileLink creates an OSC 8 file URL with the supplied label', t => {
	const link = createTerminalFileLink('/tmp/implementation plan.md', 'Plan');

	t.is(
		link,
		'\u001B]8;;file:///tmp/implementation%20plan.md\u0007Plan\u001B]8;;\u0007',
	);
});
