import test from 'ava';
import type {Key} from 'ink';
import {isNewlineKey} from './newline-key';

/**
 * The `Key` values here are not invented: they are what Ink's keypress parser
 * plus `useInput`'s mapping actually produce for each byte sequence, captured
 * by running the sequence through `ink/build/parse-keypress.js`. Each case
 * names the sequence and the terminal that sends it.
 */
const keyFor = (overrides: Partial<Key>): Key =>
	({
		upArrow: false,
		downArrow: false,
		leftArrow: false,
		rightArrow: false,
		pageDown: false,
		pageUp: false,
		home: false,
		end: false,
		return: false,
		escape: false,
		ctrl: false,
		shift: false,
		tab: false,
		backspace: false,
		delete: false,
		meta: false,
		...overrides,
	}) as Key;

// --- recognised as newline ---

test('LF from Ctrl+J inserts a newline', t => {
	// '\n' parses to name 'enter', so key.return is false.
	t.true(isNewlineKey('\n', keyFor({})));
});

test('Ctrl+J reported as a modified letter inserts a newline', t => {
	// How Ctrl+J arrives under the kitty keyboard protocol (ESC [106;5u).
	t.true(isNewlineKey('j', keyFor({ctrl: true})));
});

test('Shift+Enter in the kitty CSI-u encoding inserts a newline', t => {
	// ESC [13;2u -> name 'return', shift true.
	t.true(isNewlineKey('\r', keyFor({return: true, shift: true})));
});

test('Alt+Enter in the kitty CSI-u encoding inserts a newline', t => {
	// ESC [13;3u -> name 'return', meta true.
	t.true(isNewlineKey('\r', keyFor({return: true, meta: true})));
});

test('ESC+CR (Option+Enter on macOS) inserts a newline', t => {
	// ESC CR -> name 'return', option true, which Ink surfaces as meta.
	t.true(isNewlineKey('\r', keyFor({return: true, meta: true})));
});

// --- not a newline ---

test('a bare carriage return submits rather than inserting a newline', t => {
	// Plain Enter, and Shift+Enter in the many terminals that send it as a bare
	// '\r'. Byte-identical to submit, so it cannot be treated as a newline.
	t.false(isNewlineKey('\r', keyFor({return: true})));
});

test('a plain character is not a newline key', t => {
	t.false(isNewlineKey('a', keyFor({})));
});

test('other ctrl combinations are not newline keys', t => {
	t.false(isNewlineKey('o', keyFor({ctrl: true})));
	t.false(isNewlineKey('k', keyFor({ctrl: true})));
});

test('forward Delete is not mistaken for Enter-with-modifier', t => {
	t.false(isNewlineKey('', keyFor({delete: true})));
});
