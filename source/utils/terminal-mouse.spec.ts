import test from 'ava';
import {stripMouseSequences} from './terminal-mouse.js';

test('passes plain text through untouched', t => {
	const r = stripMouseSequences('hello world');
	t.is(r.clean, 'hello world');
	t.deepEqual(r.wheel, []);
	t.is(r.carry, '');
});

test('strips wheel events and reports direction', t => {
	const r = stripMouseSequences('\x1b[<64;10;5Mabc\x1b[<65;10;5M');
	t.is(r.clean, 'abc');
	t.deepEqual(r.wheel, ['up', 'down']);
});

test('strips click press/release without emitting wheel', t => {
	const r = stripMouseSequences('\x1b[<0;3;4M\x1b[<0;3;4mtyped');
	t.is(r.clean, 'typed');
	t.deepEqual(r.wheel, []);
});

test('wheel with modifier bits still detected', t => {
	// 64 | 4 (shift) = 68 up; 65 | 8 (alt) = 73 down
	const r = stripMouseSequences('\x1b[<68;1;1M\x1b[<73;1;1M');
	t.deepEqual(r.wheel, ['up', 'down']);
});

test('lone ESC (the Escape key) is NOT held back', t => {
	const r = stripMouseSequences('\x1b');
	t.is(r.clean, '\x1b');
	t.is(r.carry, '');
});

test('arrow keys are NOT held back or stripped', t => {
	const r = stripMouseSequences('\x1b[A\x1b[B');
	t.is(r.clean, '\x1b[A\x1b[B');
	t.is(r.carry, '');
});

test('partial mouse sequence is carried and completed next chunk', t => {
	const first = stripMouseSequences('abc\x1b[<64;1');
	t.is(first.clean, 'abc');
	t.is(first.carry, '\x1b[<64;1');
	const second = stripMouseSequences(';5M', first.carry);
	t.is(second.clean, '');
	t.deepEqual(second.wheel, ['up']);
	t.is(second.carry, '');
});
