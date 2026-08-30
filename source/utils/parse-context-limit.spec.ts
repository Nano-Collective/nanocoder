import test from 'ava';
import {parseContextLimit} from './parse-context-limit';

test('parseContextLimit - plain number', t => {
	t.is(parseContextLimit('8192'), 8192);
});

test('parseContextLimit - k suffix lowercase', t => {
	t.is(parseContextLimit('128k'), 128000);
});

test('parseContextLimit - K suffix uppercase', t => {
	t.is(parseContextLimit('128K'), 128000);
});

test('parseContextLimit - fractional k value', t => {
	t.is(parseContextLimit('4.5k'), 4500);
});

test('parseContextLimit - zero returns null', t => {
	t.is(parseContextLimit('0'), null);
});

test('parseContextLimit - negative returns null', t => {
	t.is(parseContextLimit('-5'), null);
});

test('parseContextLimit - non-numeric returns null', t => {
	t.is(parseContextLimit('abc'), null);
});

test('parseContextLimit - just k returns null', t => {
	t.is(parseContextLimit('k'), null);
});

test('parseContextLimit - whitespace is trimmed', t => {
	t.is(parseContextLimit('  8192  '), 8192);
});

test('parseContextLimit - large value with k suffix', t => {
	t.is(parseContextLimit('256k'), 256000);
});

test('parseContextLimit - decimal without k suffix', t => {
	t.is(parseContextLimit('1024.5'), 1025);
});

test('parseContextLimit - rejects trailing junk after k suffix', t => {
	t.is(parseContextLimit('10kg'), null);
	t.is(parseContextLimit('128kb'), null);
});

test('parseContextLimit - rejects trailing junk after number', t => {
	t.is(parseContextLimit('128abc'), null);
	t.is(parseContextLimit('1024.5tokens'), null);
});
