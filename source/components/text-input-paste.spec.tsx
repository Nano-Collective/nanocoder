import test from 'ava';
import {render} from 'ink-testing-library';
import React, {useState} from 'react';
import TextInput from './text-input';
import {pasteEvents} from '../utils/terminal-paste';

/**
 * Bracketed-paste tests for the shared TextInput (issue #1456).
 *
 * cli.tsx lifts every bracketed paste off stdin and re-emits it on the
 * pasteEvents singleton, so each focused TextInput must subscribe here —
 * previously only the main composer did and every other field silently
 * dropped pastes.
 *
 * pasteEvents is a module singleton, so these run serially: a concurrently
 * mounted input would also receive the payload.
 */

interface ValueRef {
	current: string;
}

function ControlledTextInput({
	valueRef,
	initialValue = '',
	focus = true,
	onPaste,
	onSubmit,
}: {
	valueRef: ValueRef;
	initialValue?: string;
	focus?: boolean;
	onPaste?: (payload: string) => void;
	onSubmit?: (value: string) => void;
}) {
	const [value, setValue] = useState(initialValue);
	valueRef.current = value;
	return (
		<TextInput
			value={value}
			onChange={setValue}
			focus={focus}
			onPaste={onPaste}
			onSubmit={onSubmit}
		/>
	);
}

const press = (stdin: ReturnType<typeof render>['stdin'], key: string) =>
	new Promise<void>(resolve => {
		stdin.write(key);
		setTimeout(resolve, 20);
	});

const waitForValue = (valueRef: ValueRef, predicate: (v: string) => boolean) =>
	new Promise<void>(resolve => {
		const start = Date.now();
		const poll = () => {
			if (predicate(valueRef.current) || Date.now() - start > 2000) {
				resolve();
			} else {
				setTimeout(poll, 20);
			}
		};
		poll();
	});

const wait = (ms: number) =>
	new Promise<void>(resolve => {
		setTimeout(resolve, ms);
	});

test.serial('TextInput inserts a single-line paste at the caret', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abc" />,
	);

	// Move caret between 'a' and 'bc'.
	await press(stdin, '\u001B[D');
	await press(stdin, '\u001B[D');

	pasteEvents.emit('paste', 'XY');
	await waitForValue(valueRef, v => v === 'aXYbc');

	t.is(valueRef.current, 'aXYbc');
	unmount();
});

test.serial(
	'TextInput inserts a multi-line paste verbatim without submitting',
	async t => {
		const valueRef: ValueRef = {current: ''};
		let submitted = 0;
		const {unmount} = render(
			<ControlledTextInput
				valueRef={valueRef}
				initialValue=""
				onSubmit={() => submitted++}
			/>,
		);

		// A pasted newline must stay text: it never reaches Ink's keypress
		// parser, so it cannot submit.
		pasteEvents.emit('paste', 'line one\nline two');
		await waitForValue(valueRef, v => v === 'line one\nline two');

		t.is(valueRef.current, 'line one\nline two');
		t.is(submitted, 0, 'a pasted newline must not submit the input');
		unmount();
	},
);

test.serial('TextInput ignores pastes while unfocused', async t => {
	const valueRef: ValueRef = {current: ''};
	const {unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abc" focus={false} />,
	);

	await wait(50);
	pasteEvents.emit('paste', 'should not appear');
	await wait(100);

	t.is(valueRef.current, 'abc');
	unmount();
});

test.serial(
	'TextInput prefers onPaste over the default splice',
	async t => {
		const valueRef: ValueRef = {current: ''};
		let custom: string | undefined;
		const {unmount} = render(
			<ControlledTextInput
				valueRef={valueRef}
				initialValue="abc"
				onPaste={payload => {
					custom = payload;
				}}
			/>,
		);

		await wait(50);
		pasteEvents.emit('paste', 'XY');
		await wait(100);

		t.is(custom, 'XY');
		t.is(valueRef.current, 'abc', 'default splice must not also run');
		unmount();
	},
);
