import test from 'ava';
import chalk from 'chalk';
import {render} from 'ink-testing-library';
import React, {useState} from 'react';
import TextInput from './text-input.js';

// Setup to force chalk to render colors in tests
process.env.FORCE_COLOR = '1';
chalk.level = 1;

function Wrapper() {
	const [val, setVal] = useState('😀abc');
	return (
		<TextInput value={val} onChange={setVal} showCursor={true} focus={true} />
	);
}

test('cursor rendering handles emoji correctly', async t => {
	const {lastFrame, stdin} = render(<Wrapper />);

	const delay = () => new Promise(r => setTimeout(r, 10));

	await delay();
	// Check initial frame (cursor on space at the end)
	// Expect: 😀abc[cursor on space]
	t.is(lastFrame(), `😀abc\u001B[7m \u001B[27m`);

	// Move left
	stdin.write('\x1B[D');
	await delay();
	// Expect: 😀ab[cursor on c]
	t.is(lastFrame(), `😀ab\u001B[7mc\u001B[27m`);

	// Move left again
	stdin.write('\x1B[D');
	await delay();
	// Expect: 😀a[cursor on b]c
	t.is(lastFrame(), `😀a\u001B[7mb\u001B[27mc`);

	// Move left again
	stdin.write('\x1B[D');
	await delay();
	// Expect: 😀[cursor on a]bc
	t.is(lastFrame(), `😀\u001B[7ma\u001B[27mbc`);

	// Move left again (onto the emoji)
	stdin.write('\x1B[D');
	await delay();
	// Expect: [cursor on 😀]abc -> Note: this tests the actual fix
	t.is(lastFrame(), `\u001B[7m😀\u001B[27mabc`);

	t.pass();
});
