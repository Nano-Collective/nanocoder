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

test('parseContextLimit - m suffix lowercase', t => {
	t.is(parseContextLimit('1m'), 1000000);
});

test('parseContextLimit - M suffix uppercase', t => {
	t.is(parseContextLimit('1M'), 1000000);
});

test('parseContextLimit - fractional m value', t => {
	t.is(parseContextLimit('1.5m'), 1500000);
});

test('parseContextLimit - large m value', t => {
	t.is(parseContextLimit('128m'), 128000000);
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

test('parseContextLimit - decimal without suffix rounds to whole tokens', t => {
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

// These parsed before the anchored-regex fix. Pin them so a future loosening of
// the pattern has to be deliberate rather than accidental.
test('parseContextLimit - rejects exponent, sign and partial decimal forms', t => {
	t.is(parseContextLimit('1e5'), null);
	t.is(parseContextLimit('.5k'), null);
	t.is(parseContextLimit('+5'), null);
	t.is(parseContextLimit('1.'), null);
});

test('parseContextLimit - rejects internal whitespace', t => {
	t.is(parseContextLimit('128 k'), null);
	t.is(parseContextLimit('1 024'), null);
});

test('parseContextLimit - rejects separators', t => {
	t.is(parseContextLimit('1,024'), null);
	t.is(parseContextLimit('8_192'), null);
});

test('parseContextLimit - empty string returns null', t => {
	t.is(parseContextLimit(''), null);
	t.is(parseContextLimit('   '), null);
});

test('parseContextLimit - overflowing digit string returns null', t => {
	t.is(parseContextLimit('9'.repeat(400)), null);
});

// Validated after scaling and rounding: these were finite and positive when
// parsed, but became 0 or Infinity before reaching the caller. See #1590.
test('parseContextLimit - fraction that rounds to zero returns null', t => {
	t.is(parseContextLimit('0.1'), null);
	t.is(parseContextLimit('0.4'), null);
});

test('parseContextLimit - value that overflows only after k scaling returns null', t => {
	t.is(parseContextLimit('9'.repeat(308) + 'k'), null);
});

test('parseContextLimit - smallest suffixed values that round to a positive limit', t => {
	t.is(parseContextLimit('1.5k'), 1500);
});

test('parseContextLimit - fractional values round without a suffix', t => {
	t.is(parseContextLimit('1.5'), 2);
	t.is(parseContextLimit('0.5'), 1);
	t.is(parseContextLimit('1.5k'), 1500);
	t.is(parseContextLimit('1.5m'), 1500000);
});

test('parseContextLimit - accepts whitespace around valid values', t => {
	t.is(parseContextLimit(' 1m '), 1000000);
	t.is(parseContextLimit('\t1.5K\n'), 1500);
});

test('parseContextLimit - rejects unsafe and overflowing values', t => {
	t.is(parseContextLimit('9007199254740991'), Number.MAX_SAFE_INTEGER);
	t.is(parseContextLimit('9007199254740992'), null);
	t.is(parseContextLimit('9007199254740991k'), null);
	t.is(parseContextLimit('9007199254.740991m'), null);
	t.is(parseContextLimit('0.0001k'), null);
	t.is(parseContextLimit('9'.repeat(400)), null);
});

test('parseContextLimit - rejects unsupported and malformed suffixes', t => {
	for (const value of [
		'',
		'abc',
		'1b',
		'1kk',
		'1kg',
		'128abc',
		'1e5',
		'.5k',
		'1.',
		'128 k',
		'1 024',
		'1,000',
		'1_000',
	]) {
		t.is(parseContextLimit(value), null, value);
	}
});
