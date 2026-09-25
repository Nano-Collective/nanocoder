import test from 'ava';
import chalk from 'chalk';
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

// --- Backspace (\x7f) ---
// Ink parses the physical Backspace (\x7f — sent by macOS Terminal, iTerm2
// and essentially all Linux terminals) as `key.delete`, NOT `key.backspace`
// (which Ink reserves for \b/Ctrl+H). So Backspace must be routed to a
// backward delete by matching the raw sequence, distinct from forward Delete
// (\x1b[3~).

test('component Backspace (\x7f) removes the character before the cursor', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abcde" />,
	);

	// Cursor is at the end; Backspace must remove 'e'.
	await press(stdin, '\u007f');

	await waitForValue(valueRef, v => v === 'abcd');
	t.is(valueRef.current, 'abcd');
	unmount();
});

test('component Backspace (\x7f) with cursor between chars removes the char before', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abcde" />,
	);

	// Move left once so the cursor sits between 'd' and 'e'; Backspace should
	// remove 'd' (the char before the cursor), leaving "abce".
	await press(stdin, '\u001b[D'); // left
	await press(stdin, '\u007f'); // Backspace

	await waitForValue(valueRef, v => v === 'abce');
	t.is(valueRef.current, 'abce');
	unmount();
});

test('component Backspace (\x7f) with cursor at start does nothing', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abc" />,
	);

	// Move to the start with Home, then Backspace should be a no-op.
	await press(stdin, '\u001b[H');
	await press(stdin, '\u007f');

	await waitForValue(valueRef, v => v === 'abc');
	t.is(valueRef.current, 'abc');
	unmount();
});

// --- Option/Alt+Backspace (\x1b\x7f) ---
// On macOS/Linux, Option/Alt+Backspace sends ESC followed by DEL ('\x1b\x7f').
// Ink parses it as `key.delete`, exactly like forward Delete ('\x1b[3~'), so
// it must be routed to a backward delete via the raw sequence.

test('component Alt+Backspace (\x1b\x7f) removes the char before the cursor', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abcde" />,
	);

	// Move left once so the cursor sits between 'd' and 'e'; Alt+Backspace
	// must remove 'd' (the char before the cursor), leaving "abce" — the same
	// result as bare Backspace, NOT the forward-delete result "abcd".
	await press(stdin, '\u001b[D'); // left
	await press(stdin, '\u001b\x7f'); // Alt+Backspace

	await waitForValue(valueRef, v => v === 'abce');
	t.is(valueRef.current, 'abce');

	// The cursor must still sit between 'c' and 'e': the next typed char
	// inserts there instead of appending at the end.
	await press(stdin, 'x');
	await waitForValue(valueRef, v => v === 'abcxe');
	t.is(valueRef.current, 'abcxe');
	unmount();
});

// A forward Delete (\x1b[3~) must NOT be treated as a Backspace even when the
// cursor is mid-line — this pins the raw-sequence disambiguation.
test('component Delete (\x1b[3~) still forward-deletes, distinct from Backspace', async t => {
	const valueRef: ValueRef = {current: ''};
	const {stdin, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="abcde" />,
	);

	// Move left once so the cursor sits between 'd' and 'e'; forward Delete
	// should remove 'e' (after the cursor), giving "abcd" — the opposite of
	// the Backspace case above.
	await press(stdin, '\u001b[D'); // left
	await press(stdin, '\u001b[3~'); // Delete

	await waitForValue(valueRef, v => v === 'abcd');
	t.is(valueRef.current, 'abcd');
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

// --- Astral characters (an emoji is a surrogate pair: two UTF-16 units) ---
//
// Cursor offsets count UTF-16 units. The render loop used to count code points
// instead, and the edit keys stepped one unit at a time, so an emoji in the
// value desynced the caret and let Backspace/Delete split the pair.

const LEFT = '\u001b[D';
const RIGHT = '\u001b[C';
const DOWN = '\u001b[B';
const HOME = '\u001b[H';
const END = '\u001b[F';
const DELETE = '\u001b[3~';
const BACKSPACE = '\u007f';
const CTRL_B = '\u0002';
const CTRL_F = '\u0006';

test('component Left moves the caret one visible character at a time across an emoji', async t => {
	// The caret is an inverse-video run, which chalk drops at level 0 (no TTY),
	// so pin the level for this render.
	const originalLevel = chalk.level;
	chalk.level = 1;
	t.teardown(() => {
		chalk.level = originalLevel;
	});

	const valueRef: ValueRef = {current: ''};
	const {stdin, lastFrame, unmount} = render(
		<ControlledTextInput valueRef={valueRef} initialValue="😀abc" />,
	);
	t.teardown(unmount);

	const frames = [
		`😀ab${chalk.inverse('c')}`,
		`😀a${chalk.inverse('b')}c`,
		`😀${chalk.inverse('a')}bc`,
		`${chalk.inverse('😀')}abc`,
	];
	for (const [index, expected] of frames.entries()) {
		await press(stdin, LEFT);
		// Poll: a fixed sleep can read the frame before Ink has flushed it.
		const start = Date.now();
		while (
			!(lastFrame() ?? '').includes(expected) &&
			Date.now() - start < 2000
		) {
			await new Promise(resolve => setTimeout(resolve, 20));
		}
		const frame = lastFrame() ?? '';
		t.true(
			frame.includes(expected),
			`after Left #${index + 1}: ${JSON.stringify(frame)}`,
		);
	}
});

const emojiEdits: Array<
	[name: string, initial: string, keys: string[], expected: string]
> = [
	['Backspace removes a whole emoji', 'a😀b', [END, LEFT, BACKSPACE], 'ab'],
	['Delete removes a whole emoji', 'a😀b', [HOME, RIGHT, DELETE], 'ab'],
	['Left steps over a whole emoji', '😀', [LEFT, 'X'], 'X😀'],
	['Right steps over a whole emoji', '😀', [HOME, RIGHT, 'X'], '😀X'],
	['Ctrl+B steps over a whole emoji', '😀', [CTRL_B, 'X'], 'X😀'],
	['Ctrl+F steps over a whole emoji', '😀', [HOME, CTRL_F, 'X'], '😀X'],
	[
		'Down lands beside an emoji, not inside it',
		'abc\n😀x',
		[HOME, RIGHT, DOWN, 'X'],
		'abc\nX😀x',
	],
];

for (const [name, initial, keys, expected] of emojiEdits) {
	test(`component ${name}`, async t => {
		const valueRef: ValueRef = {current: initial};
		const {stdin, unmount} = render(
			<ControlledTextInput valueRef={valueRef} initialValue={initial} />,
		);
		t.teardown(unmount);

		for (const key of keys) {
			await press(stdin, key);
		}

		t.is(valueRef.current, expected);
	});
}
