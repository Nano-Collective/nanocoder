import test from 'ava';

import {BASH_MAX_OUTPUT_BYTES} from '../constants.js';
import {
	makeStreamCollector,
	STDOUT_TRUNCATION_NOTICE,
} from './stream-collector.js';

console.log(`\nstream-collector.spec.ts`);

function makeSink() {
	let text = '';
	const collector = makeStreamCollector(chunk => {
		text += chunk;
	}, STDOUT_TRUNCATION_NOTICE);
	return {collector, read: () => text};
}

function makeKeepLatestSink() {
	let text = '';
	const collector = makeStreamCollector(
		chunk => {
			text += chunk;
		},
		STDOUT_TRUNCATION_NOTICE,
		{keepLatest: true},
	);
	return {collector, read: () => text};
}

test('a multi-byte character split across two chunks decodes as one character', t => {
	const {collector, read} = makeSink();
	// em dash: 0xe2 0x80 0x94, arriving one byte at a time
	const bytes = Buffer.from('—', 'utf8');
	for (const byte of bytes) {
		collector.collect(Buffer.from([byte]));
	}
	collector.flush();

	t.is(read(), '—');
});

test('bytes held back mid-character are not emitted until the rest arrives', t => {
	const {collector, read} = makeSink();
	collector.collect(Buffer.from([0x61, 0xe2, 0x80]));

	t.is(read(), 'a', 'the incomplete sequence stays in the decoder');

	collector.collect(Buffer.from([0x94]));
	t.is(read(), 'a—');
});

test('a dangling incomplete sequence is flushed at end of stream, not dropped', t => {
	const {collector, read} = makeSink();
	collector.collect(Buffer.from([0x61, 0x62, 0xc3]));
	collector.flush();

	t.is(
		read(),
		'ab�',
		'a genuinely truncated tail still surfaces as a replacement character',
	);
});

test('flush is a no-op when the stream ended on a character boundary', t => {
	const {collector, read} = makeSink();
	collector.collect(Buffer.from('done', 'utf8'));
	collector.flush();
	collector.flush();

	t.is(read(), 'done');
});

test('a cut landing mid-character drops the partial byte rather than trailing the marker', t => {
	const {collector, read} = makeSink();
	collector.collect(Buffer.alloc(BASH_MAX_OUTPUT_BYTES - 1, 'A'));
	collector.collect(Buffer.from('—', 'utf8'));
	collector.flush();

	const output = read();
	t.true(
		output.endsWith(STDOUT_TRUNCATION_NOTICE),
		'the marker should be the last thing in the stream',
	);
	t.false(
		output.includes('�'),
		'no replacement character should leak past the cap',
	);
});

test('the truncation marker is appended exactly once', t => {
	const {collector, read} = makeSink();
	for (let i = 0; i < 3; i++) {
		collector.collect(Buffer.alloc(BASH_MAX_OUTPUT_BYTES, 'A'));
	}
	collector.flush();

	const matches = read().split(STDOUT_TRUNCATION_NOTICE).length - 1;
	t.is(matches, 1);
});

test('each collector owns its own budget', t => {
	const first = makeSink();
	const second = makeSink();
	first.collector.collect(Buffer.alloc(BASH_MAX_OUTPUT_BYTES, 'A'));
	second.collector.collect(Buffer.from('still recorded', 'utf8'));
	second.collector.flush();

	t.is(second.read(), 'still recorded');
});

// ============================================================================
// Background jobs: keepLatest
// ============================================================================

test('keepLatest keeps delivering new output once the buffer has been trimmed', t => {
	const {collector, read} = makeKeepLatestSink();
	// Fill the window just under the cap, then push past it and add fresh text:
	// the head is dropped and the delivery cursor has to shift with it, or the
	// newest output is swallowed instead of delivered.
	collector.collect(Buffer.alloc(BASH_MAX_OUTPUT_BYTES - 10, 'A'));
	collector.collect(Buffer.from('B'.repeat(100), 'utf8'));
	collector.collect(Buffer.from('LATEST-LINE\n', 'utf8'));
	collector.flush();

	const output = read();
	t.true(
		output.includes('LATEST-LINE'),
		'the newest output must still be delivered after a trim',
	);
});

test('keepLatest delivers the text of a chunk that crosses the cap', t => {
	const {collector, read} = makeKeepLatestSink();
	collector.collect(Buffer.alloc(BASH_MAX_OUTPUT_BYTES, 'A'));
	collector.collect(Buffer.from('C'.repeat(64 * 1024), 'utf8'));
	collector.flush();

	const output = read();
	t.true(
		output.includes('C'.repeat(64 * 1024)),
		'the text of a chunk that crossed the cap must still be delivered',
	);
});

test('keepLatest trim of a chunk past the cap is linear in the chunk size', async t => {
	const {collector, read} = makeKeepLatestSink();
	const big = Buffer.from('z'.repeat(6 * 1024 * 1024), 'utf8');
	const start = Date.now();
	collector.collect(big);
	collector.flush();
	const elapsed = Date.now() - start;

	t.true(
		elapsed < 2000,
		`trimming a chunk past the cap took ${elapsed}ms, expected it to stay fast`,
	);
	t.true(read().includes('z'.repeat(6 * 1024 * 1024)));
});
