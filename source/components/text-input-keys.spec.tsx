import test from 'ava';
import {render} from 'ink-testing-library';
import React, {useState} from 'react';
import TextInput from './text-input';

/**
 * Component-level keyboard tests for TextInput (issue #3 remediation).
 *
 * The pure-logic tests in text-input.spec.ts exercise duplicated helper
 * functions, not the real useInput handlers. These tests render the actual
 * TextInput component and drive real key sequences through stdin so the
 * `key.home`, `key.end`, and `key.delete` branches are exercised for real.
 *
 * Ink key sequences used:
 *   Home      \u001b[H
 *   End       \u001b[F
 *   Delete    \u001b[3~
 *   Left      \u001b[D
 */

// Controlled wrapper: holds `value` in React state and feeds it back to
// TextInput via onChange. The latest value is mirrored to a ref so tests can
// read it after Ink processes keys.
interface ValueRef {
	current: string;
}

function ControlledTextInput({
	valueRef,
	initialValue = '',
	showCursor = true,
}: {
	valueRef: ValueRef;
	initialValue?: string;
	showCursor?: boolean;
}) {
	const [value, setValue] = useState(initialValue);
	valueRef.current = value;
	return (
		<TextInput
			value={value}
			onChange={setValue}
			focus={true}
			showCursor={showCursor}
		/>
	);
}

// Write a key then wait a tick for Ink to process it.
const press = (stdin: ReturnType<typeof render>['stdin'], key: string) =>
	new Promise<void>(resolve => {
		stdin.write(key);
		setTimeout(resolve, 20);
	});

// Wait until valueRef.current matches the predicate.
const waitForValue = (
	valueRef: ValueRef,
	predicate: (v: string) => boolean,
) =>
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

// --- Delete (key.delete) ---

test('component Delete removes the character after the cursor', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abcde" />,
	);

	// Cursor is at the end; move left twice so it lands between 'c' and 'd'.
	await press(stdin, '\u001b[D'); // left
	await press(stdin, '\u001b[D'); // left
	await press(stdin, '\u001b[3~'); // Delete -> removes 'd'

	await waitForValue(valueRef, v => v === 'abce');
	t.is(valueRef.current, 'abce');
	unmount();
});

test('component Delete with cursor at start removes first character', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="hello" />,
	);

	// Move cursor to start with Home, then Delete removes 'h'.
	await press(stdin, '\u001b[H');
	await press(stdin, '\u001b[3~');

	await waitForValue(valueRef, v => v === 'ello');
	t.is(valueRef.current, 'ello');
	unmount();
});

test('component Delete with cursor at end does nothing', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abc" />,
	);

	// Cursor already at end; Delete should be a no-op.
	await press(stdin, '\u001b[3~');

	await waitForValue(valueRef, v => v === 'abc');
	t.is(valueRef.current, 'abc');
	unmount();
});

// --- Home / End ---

test('component Home moves cursor to start (next typed char inserts at 0)', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abc" />,
	);

	await press(stdin, '\u001b[H'); // Home -> cursor at 0
	await press(stdin, 'x'); // insert 'x' at start

	await waitForValue(valueRef, v => v === 'xabc');
	t.is(valueRef.current, 'xabc');
	unmount();
});

test('component End moves cursor to end (next typed char appends)', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abc" />,
	);

	await press(stdin, '\u001b[H'); // Home -> cursor at 0
	await press(stdin, '\u001b[F'); // End -> cursor at 3
	await press(stdin, 'z'); // append 'z'

	await waitForValue(valueRef, v => v === 'abcz');
	t.is(valueRef.current, 'abcz');
	unmount();
});

test('component Home on empty value leaves cursor at 0 (typing not affected)', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="" />,
	);

	await press(stdin, '\u001b[H');
	await press(stdin, 'x');

	await waitForValue(valueRef, v => v === 'x');
	t.is(valueRef.current, 'x');
	unmount();
});

// --- Home / End with showCursor={false} (issue #8) ---
// When the cursor is hidden, cursor-movement keys must be no-ops to match the
// other navigation bindings (arrows, Ctrl+Left/Right, Ctrl+B/F) that all guard
// on showCursor. A Home/End that still moves an invisible cursor would desync
// the next insert.

test('component Home does not move cursor when showCursor is false', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abc" showCursor={false} />,
	);

	// Home is ignored, so typing still appends at the end (cursor stayed put).
	await press(stdin, '\u001b[H');
	await press(stdin, 'x');

	await waitForValue(valueRef, v => v === 'abcx');
	t.is(valueRef.current, 'abcx');
	unmount();
});

	test('component End does not move cursor when showCursor is false', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abc" showCursor={false} />,
	);

	// Navigate to the start is also guarded; with showCursor=false even that
	// must not move, so a subsequent insertion lands at the end.
	await press(stdin, '\u001b[H');
	await press(stdin, '\u001b[F');
	await press(stdin, 'x');

	await waitForValue(valueRef, v => v === 'abcx');
	t.is(valueRef.current, 'abcx');
	unmount();
});

// --- Ctrl+A / Ctrl+E with showCursor={false} (issue #2) ---
// The readline "go to start/end of line" binds must honour showCursor exactly
// like arrows, Home/End and Ctrl+B/F — otherwise an invisible cursor desyncs
// the next insert.

test('component Ctrl+A does not move cursor when showCursor is false', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abc" showCursor={false} />,
	);

	// Ctrl+A (^A) would jump to the start when the cursor is visible; with
	// showCursor=false it must be ignored, so typing still appends at the end.
	await press(stdin, '\u0001');
	await press(stdin, 'x');

	await waitForValue(valueRef, v => v === 'abcx');
	t.is(valueRef.current, 'abcx');
	unmount();
});

test('component Ctrl+E does not move cursor when showCursor is false', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abc" showCursor={false} />,
	);

	// Ctrl+E (^E) would jump to the end; with showCursor=false it must be
	// ignored, so typing appends at the (unchanged) end.
	await press(stdin, '\u0005');
	await press(stdin, 'x');

	await waitForValue(valueRef, v => v === 'abcx');
	t.is(valueRef.current, 'abcx');
	unmount();
});

test('component Ctrl+A moves to start when showCursor is true (positive control)', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abc" />,
	);

	// With showCursor=true (default), Ctrl+A genuinely jumps to the start, so
	// the next typed char inserts at 0 — proving the guard is the differentiator.
	await press(stdin, '\u0001');
	await press(stdin, 'x');

	await waitForValue(valueRef, v => v === 'xabc');
	t.is(valueRef.current, 'xabc');
	unmount();
});
