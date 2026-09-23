import test from 'ava';
import {splitControlKeypresses} from './terminal-keypress.js';

test('splits a run of Backspaces into one piece per key', t => {
	t.deepEqual(splitControlKeypresses('\x7f\x7f\x7f'), ['\x7f', '\x7f', '\x7f']);
});

test('splits control keys out of surrounding text', t => {
	t.deepEqual(splitControlKeypresses('abc\x1a\x1adef'), [
		'abc',
		'\x1a',
		'\x1a',
		'def',
	]);
});

test('leaves plain text as a single piece', t => {
	t.deepEqual(splitControlKeypresses('hello world'), ['hello world']);
});

test('keeps line breaks and tabs attached for the paste heuristic', t => {
	t.deepEqual(splitControlKeypresses('one\r\ntwo\tthree\n'), [
		'one\r\ntwo\tthree\n',
	]);
});

test('keeps escape sequences and Meta chords intact', t => {
	t.deepEqual(splitControlKeypresses('\x1b[A\x1b\x7f'), ['\x1b[A\x1b\x7f']);
	t.deepEqual(splitControlKeypresses('\x1b\x01\x01'), ['\x1b\x01', '\x01']);
});

test('returns nothing for empty input', t => {
	t.deepEqual(splitControlKeypresses(''), []);
});
