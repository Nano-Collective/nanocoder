import test from 'ava';
import {render} from 'ink-testing-library';
import React, {useState} from 'react';
import TextInput from './text-input';

/**
 * Newline insertion, driven through stdin as real byte sequences.
 *
 * Shift+Enter has no single encoding — what reaches the process depends
 * entirely on the terminal, so each case below is named by the bytes and by
 * who sends them. The regressions these guard:
 *
 * - ESC+CR submitted the prompt instead of inserting a newline
 * - the xterm modifyOtherKeys form was unparseable by Ink and its ESC-stripped
 *   sequence was inserted into the prompt as the literal text `[27;2;13~`
 * - the kitty CSI-u form appended '\n' to the end of the value rather than at
 *   the cursor, and left the cursor stranded in front of it, so the next
 *   character typed went on the wrong line
 *
 * Sequences used:
 *   LF (Ctrl+J)                  \n
 *   ESC+CR (Option/Alt+Enter)    ESC \r
 *   kitty CSI-u Shift+Enter      ESC [13;2u
 *   xterm modifyOtherKeys        ESC [27;2;13~
 *   bare CR (Enter)              \r
 *   Left                         ESC [D
 */

const ESC = '\u001b';
const LF = '\n';
const ESC_CR = `${ESC}\r`;
const KITTY_SHIFT_ENTER = `${ESC}[13;2u`;
const XTERM_SHIFT_ENTER = `${ESC}[27;2;13~`;
const LEFT = `${ESC}[D`;

interface ValueRef {
	current: string;
}

function ControlledTextInput({
	valueRef,
	initialValue = '',
}: {
	valueRef: ValueRef;
	initialValue?: string;
}) {
	const [value, setValue] = useState(initialValue);
	valueRef.current = value;
	return (
		<TextInput value={value} onChange={setValue} focus={true} showCursor={true} />
	);
}

const press = (stdin: ReturnType<typeof render>['stdin'], key: string) =>
	new Promise<void>(resolve => {
		stdin.write(key);
		setTimeout(resolve, 20);
	});

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 100));

const newlineSequences: Array<[string, string]> = [
	['LF (Ctrl+J)', LF],
	['ESC+CR (Option/Alt+Enter)', ESC_CR],
	['kitty CSI-u Shift+Enter', KITTY_SHIFT_ENTER],
	['xterm modifyOtherKeys Shift+Enter', XTERM_SHIFT_ENTER],
];

for (const [label, sequence] of newlineSequences) {
	test(`${label} inserts a newline at the end of the value`, async t => {
		const valueRef: ValueRef = {current: ''};
		const {stdin, unmount} = render(
			<ControlledTextInput valueRef={valueRef} initialValue="aaa" />,
		);

		await press(stdin, sequence);
		await settle();

		t.is(valueRef.current, 'aaa\n');
		unmount();
	});

	test(`${label} leaves the cursor after the newline`, async t => {
		const valueRef: ValueRef = {current: ''};
		const {stdin, unmount} = render(
			<ControlledTextInput valueRef={valueRef} initialValue="aaa" />,
		);

		// The cursor, not the value, is what the append-to-the-end bug got
		// wrong: the newline landed correctly but the caret stayed in front of
		// it, so the next character typed went back onto the first line.
		await press(stdin, sequence);
		await press(stdin, 'b');
		await settle();

		t.is(valueRef.current, 'aaa\nb');
		unmount();
	});

	test(`${label} inserts at the cursor, not the end of the value`, async t => {
		const valueRef: ValueRef = {current: ''};
		const {stdin, unmount} = render(
			<ControlledTextInput valueRef={valueRef} initialValue="aaabbb" />,
		);

		await press(stdin, LEFT);
		await press(stdin, LEFT);
		await press(stdin, LEFT);
		await press(stdin, sequence);
		await settle();

		t.is(valueRef.current, 'aaa\nbbb');
		unmount();
	});
}

test('consecutive newlines stack instead of overwriting each other', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="a" />,
	);

	await press(stdin, LF);
	await press(stdin, 'b');
	await press(stdin, KITTY_SHIFT_ENTER);
	await press(stdin, 'c');
	await settle();

	t.is(valueRef.current, 'a\nb\nc');
	unmount();
});

test('a bare carriage return does not insert a newline', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="aaa" />,
	);

	// Plain Enter is byte-identical to Shift+Enter in most terminals, so it
	// must stay on the submit path rather than becoming a newline.
	await press(stdin, '\r');
	await settle();

	t.is(valueRef.current, 'aaa');
	unmount();
});

test('the xterm modifyOtherKeys sequence never reaches the value as text', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="" />,
	);

	await press(stdin, XTERM_SHIFT_ENTER);
	await settle();

	t.false(valueRef.current.includes('27;2;13'));
	t.false(valueRef.current.includes('['));
	unmount();
});
