import test from 'ava';
import {createPasteExtractor} from './terminal-paste';

// Tests for the bracketed paste (DECSET 2004) stdin splitter.
// The payload must never reach the keypress parser — that is the bug
// this exists to fix: a CR inside a pasted block submitted the prompt.

console.log(`\nterminal-paste.spec.ts`);

const START = '\x1b[200~';
const END = '\x1b[201~';

test('passes ordinary typing through untouched', t => {
	const extract = createPasteExtractor();
	const {clean, pastes} = extract('hello');
	t.is(clean, 'hello');
	t.deepEqual(pastes, []);
});

test('lifts a complete paste out of a single chunk', t => {
	const extract = createPasteExtractor();
	const {clean, pastes} = extract(`${START}pasted text${END}`);
	t.is(clean, '');
	t.deepEqual(pastes, ['pasted text']);
});

test('keeps carriage returns inside the payload out of the clean stream', t => {
	const extract = createPasteExtractor();
	const {clean, pastes} = extract(`${START}line one\rline two\r\nline three${END}`);
	t.is(clean, '', 'no CR may reach the keypress parser');
	t.deepEqual(pastes, ['line one\rline two\r\nline three']);
});

test('preserves text typed before and after a paste', t => {
	const extract = createPasteExtractor();
	const {clean, pastes} = extract(`before${START}middle${END}after`);
	t.is(clean, 'beforeafter');
	t.deepEqual(pastes, ['middle']);
});

test('handles two pastes in one chunk', t => {
	const extract = createPasteExtractor();
	const {clean, pastes} = extract(`${START}one${END}${START}two${END}`);
	t.is(clean, '');
	t.deepEqual(pastes, ['one', 'two']);
});

test('reassembles a payload split across chunks', t => {
	const extract = createPasteExtractor();
	const first = extract(`${START}first half `);
	t.is(first.clean, '');
	t.deepEqual(first.pastes, []);

	const second = extract(`second half${END}`);
	t.is(second.clean, '');
	t.deepEqual(second.pastes, ['first half second half']);
});

test('reassembles a start marker split across chunks', t => {
	const extract = createPasteExtractor();
	const first = extract('\x1b[2');
	t.is(first.clean, '', 'the partial marker is held back, not emitted');
	t.deepEqual(first.pastes, []);

	const second = extract(`00~payload${END}`);
	t.is(second.clean, '');
	t.deepEqual(second.pastes, ['payload']);
});

test('reassembles an end marker split across chunks', t => {
	const extract = createPasteExtractor();
	extract(`${START}payload`);
	const first = extract('\x1b');
	t.deepEqual(first.pastes, [], 'a lone ESC inside a payload may be the end marker');

	const second = extract('[201~');
	t.deepEqual(second.pastes, ['payload']);
	t.is(second.clean, '');
});

test('does not swallow a lone Escape keypress', t => {
	const extract = createPasteExtractor();
	const {clean, pastes} = extract('\x1b');
	t.is(clean, '\x1b', 'Escape must reach the app on the same chunk');
	t.deepEqual(pastes, []);
});

test('does not swallow an arrow key', t => {
	const extract = createPasteExtractor();
	const {clean, pastes} = extract('\x1b[A');
	t.is(clean, '\x1b[A');
	t.deepEqual(pastes, []);
});

test('treats an escape sequence inside a payload as literal text', t => {
	const extract = createPasteExtractor();
	const mouseLike = '\x1b[<64;10;5M';
	const {clean, pastes} = extract(`${START}${mouseLike}${END}`);
	t.is(clean, '');
	t.deepEqual(pastes, [mouseLike], 'payload is opaque, never re-parsed');
});

test('a payload containing the start marker text does not nest', t => {
	const extract = createPasteExtractor();
	const {clean, pastes} = extract(`${START}a${START}b${END}`);
	t.is(clean, '');
	t.deepEqual(pastes, [`a${START}b`]);
});

test('keeps state independent per extractor', t => {
	const a = createPasteExtractor();
	const b = createPasteExtractor();
	a.call(null, `${START}open`);
	const result = b.call(null, 'typed');
	t.is(result.clean, 'typed');
	t.deepEqual(result.pastes, []);
});
