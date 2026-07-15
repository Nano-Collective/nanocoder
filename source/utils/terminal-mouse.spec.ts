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

// ============================================================================
// Error / edge scenarios beyond the happy path
// ============================================================================

test('empty chunk with no prefix returns empty result', t => {
	const r = stripMouseSequences('');
	t.is(r.clean, '');
	t.deepEqual(r.wheel, []);
	t.is(r.carry, '');
});

test('malformed sequence missing the M/m terminator is NOT stripped mid-chunk', t => {
	// No terminator anywhere in the chunk and it's followed by more text,
	// so it can't be a genuine split-at-boundary partial (that case only
	// holds back a TRAILING run). It must pass through untouched rather
	// than being silently dropped as if it were a valid mouse report.
	const r = stripMouseSequences('\x1b[<64;10;5 not-a-terminator');
	t.is(r.clean, '\x1b[<64;10;5 not-a-terminator');
	t.deepEqual(r.wheel, []);
	t.is(r.carry, '');
});

test('malformed sequence with wrong terminator character is left intact', t => {
	const r = stripMouseSequences('\x1b[<64;10;5Xtyped');
	t.is(r.clean, '\x1b[<64;10;5Xtyped');
	t.deepEqual(r.wheel, []);
});

test('non-numeric button field does not match and is left intact', t => {
	const r = stripMouseSequences('\x1b[<ab;10;5Mtyped');
	t.is(r.clean, '\x1b[<ab;10;5Mtyped');
	t.deepEqual(r.wheel, []);
});

test('button field 0 (no bits set) is dropped without emitting wheel', t => {
	const r = stripMouseSequences('\x1b[<0;1;1M');
	t.is(r.clean, '');
	t.deepEqual(r.wheel, []);
});

test('a trailing partial longer than MAX_PARTIAL is let through, not swallowed', t => {
	// Comment in terminal-mouse.ts: "longer means it's not a mouse sequence,
	// so let it through rather than swallowing user input." Build a tail
	// that matches PARTIAL_TAIL_RE's shape but exceeds the 20-char cap.
	const longTail = '\x1b[<64;123456789012345';
	t.true(longTail.length > 20);
	const r = stripMouseSequences(longTail);
	t.is(r.clean, longTail);
	t.is(r.carry, '');
});

test('carry chains correctly across three chunks split at different points', t => {
	const first = stripMouseSequences('start\x1b[<6');
	t.is(first.clean, 'start');
	t.is(first.carry, '\x1b[<6');

	const second = stripMouseSequences('4;10', first.carry);
	t.is(second.clean, '');
	t.is(second.carry, '\x1b[<64;10');

	const third = stripMouseSequences(';5Mend', second.carry);
	t.is(third.clean, 'end');
	t.deepEqual(third.wheel, ['up']);
	t.is(third.carry, '');
});

test('carry with no matching completion this chunk still strips other sequences', t => {
	// Previous carry never resolves into a full sequence (chunk has
	// unrelated content); the carried prefix should not corrupt handling of
	// a distinct, complete sequence later in the same chunk.
	const r = stripMouseSequences(
		'unrelated text\x1b[<0;2;2m',
		'\x1b[<64;1',
	);
	// The prior carry + this chunk's leading text no longer matches the
	// mouse regex (there's no M/m right after the carried digits), so it
	// passes through as plain text, while the later complete
	// (non-wheel) release sequence is still stripped.
	t.is(r.clean, '\x1b[<64;1unrelated text');
	t.deepEqual(r.wheel, []);
});

test('multiple wheel ticks in one chunk preserve order (down, down, up)', t => {
	const r = stripMouseSequences(
		'\x1b[<65;1;1M\x1b[<65;1;1M\x1b[<64;1;1M',
	);
	t.deepEqual(r.wheel, ['down', 'down', 'up']);
	t.is(r.clean, '');
});

test('release (lowercase m) wheel event is still classified by direction bit', t => {
	const r = stripMouseSequences('\x1b[<64;1;1m');
	t.deepEqual(r.wheel, ['up']);
	t.is(r.clean, '');
});
