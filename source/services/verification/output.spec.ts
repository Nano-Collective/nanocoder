import test from 'ava';
import {
	normalizeForSignature,
	prepareOutputForModel,
	signatureOf,
	stripAnsi,
} from './output.js';

console.log('\nservices/verification/output.spec.ts');

const ESC = '\u001B';
const BEL = '\u0007';
const RESET = `${ESC}[0m`;
const RED = `${ESC}[31m`;

// ============================================================================
// stripAnsi
// ============================================================================

test('stripAnsi removes SGR colour codes', t => {
	t.is(stripAnsi(`${RED}FAIL${RESET} src/a.test.ts`), 'FAIL src/a.test.ts');
});

test('stripAnsi removes OSC sequences terminated by BEL', t => {
	t.is(stripAnsi(`${ESC}]0;window title${BEL}text`), 'text');
});

test('stripAnsi leaves plain text untouched', t => {
	t.is(stripAnsi('2 tests failed'), '2 tests failed');
});

test('stripAnsi is safe on empty input', t => {
	t.is(stripAnsi(''), '');
});

// ============================================================================
// prepareOutputForModel
// ============================================================================

test('prepareOutputForModel passes small output through untouched', t => {
	const result = prepareOutputForModel('short failure', 1000);
	t.is(result.text, 'short failure');
	t.false(result.truncated);
	t.is(result.originalBytes, 13);
});

test('prepareOutputForModel respects the byte cap', t => {
	const result = prepareOutputForModel('x'.repeat(100_000), 2000);
	t.true(result.truncated);
	t.true(
		Buffer.byteLength(result.text) <= 2000,
		`got ${Buffer.byteLength(result.text)} bytes`,
	);
	t.is(result.originalBytes, 100_000);
});

test('prepareOutputForModel keeps both the head and the tail', t => {
	const head = 'HEAD-MARKER';
	const tail = 'TAIL-MARKER';
	const input = head + 'y'.repeat(50_000) + tail;
	const result = prepareOutputForModel(input, 1000);
	t.true(result.text.startsWith(head), 'head must survive');
	t.true(result.text.endsWith(tail), 'tail must survive');
});

test('prepareOutputForModel marks the elision so the model knows', t => {
	const result = prepareOutputForModel('x'.repeat(50_000), 1000);
	t.regex(result.text, /bytes omitted/);
});

test('prepareOutputForModel does not split a multi-byte codepoint', t => {
	// "é" is 2 bytes, "→" is 3. A byte-wise cut lands mid-sequence and yields
	// U+FFFD, which is noise the model has to reason about for no reason.
	const input = '→'.repeat(5000);
	const result = prepareOutputForModel(input, 999);
	t.false(result.text.includes('�'), 'no replacement characters');
});

test('prepareOutputForModel treats a non-positive cap as pass-through', t => {
	for (const cap of [0, -1]) {
		const result = prepareOutputForModel('abc', cap);
		t.is(result.text, 'abc');
		t.false(result.truncated);
	}
});

test('prepareOutputForModel measures in bytes, not characters', t => {
	// 3 chars of '→' is 9 bytes, which must exceed a 4-byte cap.
	const result = prepareOutputForModel('→'.repeat(3), 4);
	t.true(result.truncated);
	t.true(Buffer.byteLength(result.text) <= 4);
});

// ============================================================================
// normalizeForSignature
// ============================================================================

test('normalizeForSignature is blind to durations', t => {
	t.is(
		signatureOf('FAIL in 1.2s'),
		signatureOf('FAIL in 1.9s'),
		'a slower run of the same failure is the same failure',
	);
	t.is(signatureOf('took 842ms'), signatureOf('took 91ms'));
});

test('normalizeForSignature is blind to memory and byte counts', t => {
	t.is(signatureOf('heap 512MB'), signatureOf('heap 498MB'));
	t.is(signatureOf('wrote 4096 bytes'), signatureOf('wrote 8192 bytes'));
});

test('normalizeForSignature is blind to line ordering', t => {
	// The behaviour the whole "no progress" stop rule depends on. Parallel
	// runners interleave differently every time; if this broke, the loop would
	// burn all its attempts re-reading identical errors.
	t.is(
		signatureOf('FAIL a.test.ts\nFAIL b.test.ts\nFAIL c.test.ts'),
		signatureOf('FAIL c.test.ts\nFAIL a.test.ts\nFAIL b.test.ts'),
	);
});

test('normalizeForSignature is blind to pids, ports, and pointers', t => {
	t.is(signatureOf('worker pid=1234 died'), signatureOf('worker pid=9876 died'));
	t.is(signatureOf('listening on port 51234'), signatureOf('listening on port 41002'));
	t.is(signatureOf('segv at 0xdeadbeef'), signatureOf('segv at 0xfeedface'));
});

test('normalizeForSignature is blind to the user home directory', t => {
	t.is(
		signatureOf('/home/alice/project/src/a.ts'),
		signatureOf('/home/bob/project/src/a.ts'),
	);
	t.is(
		signatureOf(String.raw`C:\Users\alice\p\src\a.ts`),
		signatureOf(String.raw`C:\Users\bob\p\src\a.ts`),
	);
});

test('normalizeForSignature is blind to CRLF vs LF', t => {
	t.is(signatureOf('a\r\nb'), signatureOf('a\nb'));
});

test('normalizeForSignature is blind to ANSI colour', t => {
	t.is(signatureOf(`${RED}FAIL${RESET} a`), signatureOf('FAIL a'));
});

test('normalizeForSignature still distinguishes different failures', t => {
	t.not(signatureOf('FAIL a.test.ts'), signatureOf('FAIL b.test.ts'));
	t.not(
		signatureOf('expected 3 but got 4'),
		signatureOf('expected 4 but got 3'),
		'argument order is meaningful and must survive',
	);
});

test('normalizeForSignature is insensitive to indentation and blank lines', t => {
	t.is(
		signatureOf('    at foo (a.ts:1)\n\n    at bar (b.ts:2)'),
		signatureOf('at foo (a.ts:1)\nat bar (b.ts:2)'),
	);
});

// ============================================================================
// signatureOf
// ============================================================================

test('signatureOf is deterministic and short', t => {
	const first = signatureOf('FAIL');
	const second = signatureOf('FAIL');
	t.is(first, second);
	t.is(first.length, 16);
});

test('signatureOf distinguishes whitespace-only differences away', t => {
	t.is(signatureOf('  FAIL  '), signatureOf('FAIL'));
});