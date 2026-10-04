import test from 'ava';
import {
	createXtermModifiedEnterRewriter,
	splitControlKeypresses,
} from './terminal-keypress.js';

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

for (const modifier of [2, 3, 5, 8]) {
	test(`rewrites modified Enter (${modifier}) at every chunk boundary`, t => {
		const sequence = `\x1b[27;${modifier};13~`;
		for (let boundary = 1; boundary < sequence.length; boundary++) {
			const output: string[] = [];
			const rewriter = createXtermModifiedEnterRewriter(text => output.push(text));
			rewriter.push(sequence.slice(0, boundary));
			t.deepEqual(output, [], `boundary ${boundary} must stay buffered`);
			rewriter.push(sequence.slice(boundary));
			t.deepEqual(output, [`\x1b[13;${modifier}u`], `boundary ${boundary}`);
			rewriter.dispose();
		}
	});
}

test('rewrites byte-by-byte input and coalesced keys in order', t => {
	const output: string[] = [];
	const rewriter = createXtermModifiedEnterRewriter(text => output.push(text));
	t.teardown(() => rewriter.dispose());
	for (const byte of '\x1b[27;2;13~') rewriter.push(byte);
	rewriter.push('a\x1b[27;3;13~\x7f\x1b[27;');
	rewriter.push('2;13~b');
	t.is(output.join(''), '\x1b[13;2ua\x1b[13;3u\x7f\x1b[13;2ub');
});

test('passes text, other escape sequences and malformed candidates unchanged', t => {
	const output: string[] = [];
	const rewriter = createXtermModifiedEnterRewriter(text => output.push(text));
	t.teardown(() => rewriter.dispose());
	const text = 'hello\r\n\t\x1b[A\x1b\r\x1b\x7f\x1b[13;2u\x1b[27;2;9~';
	rewriter.push(text);
	t.deepEqual(output, [text]);
	rewriter.push('\x1b[27;2;1');
	rewriter.push('4~tail');
	t.is(output.join(''), `${text}\x1b[27;2;14~tail`);
});

// A partial held back by one push is never dropped: push() clears the
// pending timer, then merges the carry into the next chunk (text = carry +
// chunk), so the held-back bytes are re-included and re-examined wholesale.
for (const [first, second, afterFirst, expected] of [
	['\x1b[27;', 'q', [], ['\x1b[27;q']],
	['\x1b[27;', 'ab\r', [], ['\x1b[27;ab\r']],
	['a\x1b[27;2;13', '\x1b[A', ['a'], ['a', '\x1b[27;2;13\x1b[A']],
] as const) {
	test(`re-includes a held-back partial when the next chunk does not extend it (${JSON.stringify(second)})`, t => {
		const output: string[] = [];
		const rewriter = createXtermModifiedEnterRewriter(text => output.push(text));
		t.teardown(() => rewriter.dispose());
		rewriter.push(first);
		t.deepEqual(output, afterFirst);
		rewriter.push(second);
		t.deepEqual(output, expected);
	});
}



test('flush() emits a held-back partial immediately, unrewritten, and cancels its timer', async t => {
	const output: string[] = [];
	const rewriter = createXtermModifiedEnterRewriter(text => output.push(text));
	t.teardown(() => rewriter.dispose());
	rewriter.push('before\x1b[27;2;13');
	t.deepEqual(output, ['before']);
	rewriter.flush();
	t.deepEqual(output, ['before', '\x1b[27;2;13']);
	await new Promise(resolve => setTimeout(resolve, 50));
	// Timer cancelled: no duplicate emit.
	t.deepEqual(output, ['before', '\x1b[27;2;13']);
	// Empty carry: flush is a no-op, not a stray empty emit.
	rewriter.flush();
	t.deepEqual(output, ['before', '\x1b[27;2;13']);
	rewriter.push('after');
	t.deepEqual(output, ['before', '\x1b[27;2;13', 'after']);
});

test('bounds incomplete sequence buffering', t => {
	const output: string[] = [];
	const rewriter = createXtermModifiedEnterRewriter(text => output.push(text));
	t.teardown(() => rewriter.dispose());
	const text = `\x1b[27;${'2'.repeat(100)}`;
	for (const byte of text) rewriter.push(byte);
	t.is(output.join(''), text);
});

for (const pending of ['\x1b', '\x1b[', '\x1b[27;2;13']) {
	test(`flushes an incomplete sequence ${JSON.stringify(pending)} on timeout`, async t => {
		const output: string[] = [];
		const rewriter = createXtermModifiedEnterRewriter(text => output.push(text));
		t.teardown(() => rewriter.dispose());
		rewriter.push(`before${pending}`);
		t.deepEqual(output, ['before']);
		await new Promise(resolve => setTimeout(resolve, 50));
		t.deepEqual(output, ['before', pending]);
		rewriter.push('after');
		t.deepEqual(output, ['before', pending, 'after']);
	});
}

test('disposing cancels pending input without forwarding it after shutdown', async t => {
	const output: string[] = [];
	const rewriter = createXtermModifiedEnterRewriter(text => output.push(text));
	rewriter.push('\x1b[27;2;');
	rewriter.dispose();
	await new Promise(resolve => setTimeout(resolve, 50));
	t.deepEqual(output, []);
});
