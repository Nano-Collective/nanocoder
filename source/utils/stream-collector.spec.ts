import test from 'ava';

import {
	BASH_MAX_OUTPUT_BYTES,
	BASH_MAX_OUTPUT_TAIL_BYTES,
} from '../constants.js';
import {
	makeStreamCollector,
} from './stream-collector.js';

console.log(`\nstream-collector.spec.ts`);

function makeSink() {
	let text = '';
	const collector = makeStreamCollector(chunk => {
		text += chunk;
	}, omittedBytes => `\n... [Output truncated: ${omittedBytes} bytes omitted]`);
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

test('a cap landing inside a character keeps the whole character', t => {
	const {collector, read} = makeSink();
	collector.collect(Buffer.alloc(BASH_MAX_OUTPUT_BYTES - 1, 'A'));
	collector.collect(Buffer.from('—', 'utf8'));
	collector.flush();

	const output = read();
	t.true(
		output.endsWith('—'),
		'the character the head had no room for moves to the tail whole',
	);
	t.false(output.includes('�'), 'no replacement character should appear');
	t.false(
		output.includes('... [Output truncated:'),
		'nothing was omitted, so there is no notice',
	);
});

test('the notice is appended exactly once', t => {
	const {collector, read} = makeSink();
	for (let i = 0; i < 3; i++) {
		collector.collect(Buffer.alloc(BASH_MAX_OUTPUT_BYTES, 'A'));
	}
	collector.flush();

	const matches = read().split('... [Output truncated:').length - 1;
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

test('a stream past the cap keeps its start and its ending', t => {
	const {collector, read} = makeSink();
	collector.collect(Buffer.from('START-OF-BUILD\n'));
	const flood = Buffer.alloc(64 * 1024, 'A');
	for (let i = 0; i < 200; i++) {
		collector.collect(flood);
	}
	collector.collect(Buffer.from('SUMMARY: 1 failed\n'));
	collector.flush();

	const output = read();
	t.true(output.startsWith('START-OF-BUILD\n'), 'the head is kept');
	t.true(
		output.endsWith('SUMMARY: 1 failed\n'),
		'the summary at the end of the output survives the cap (#2237)',
	);
	t.regex(output, /\[Output truncated: \d+ bytes omitted\]/);
	t.true(
		output.indexOf('SUMMARY: 1 failed') > output.indexOf('bytes omitted'),
		'the notice sits between the head and the tail',
	);
	t.true(
		output.length <=
			BASH_MAX_OUTPUT_BYTES + BASH_MAX_OUTPUT_TAIL_BYTES + 100,
		'the retained output stays within the two windows',
	);
});

test('the notice reports how many bytes fell between the head and the tail', t => {
	const {collector, read} = makeSink();
	collector.collect(
		Buffer.alloc(
			BASH_MAX_OUTPUT_BYTES + BASH_MAX_OUTPUT_TAIL_BYTES + 1234,
			'a',
		),
	);
	collector.flush();

	t.true(read().includes('... [Output truncated: 1234 bytes omitted]'));
});

test('output that only just crosses the cap is kept whole with no notice', t => {
	const {collector, read} = makeSink();
	const total = BASH_MAX_OUTPUT_BYTES + 1;
	collector.collect(Buffer.alloc(total, 'a'));
	collector.flush();

	t.is(
		read(),
		'a'.repeat(total),
		'nothing was dropped, so a notice would only corrupt the output',
	);
});

test('a tail window starting mid-character skips the orphaned bytes', t => {
	const {collector, read} = makeSink();
	collector.collect(Buffer.alloc(BASH_MAX_OUTPUT_BYTES, 'x'));

	// One window plus two bytes, so the retained window begins two bytes in: on
	// the continuation bytes of a character whose lead byte was trimmed.
	const chunk = Buffer.alloc(BASH_MAX_OUTPUT_TAIL_BYTES + 2, 'x');
	chunk[0] = 0xe2;
	chunk[1] = 0x80;
	chunk[2] = 0x94;
	collector.collect(chunk);
	collector.flush();

	const output = read();
	t.false(output.includes('�'), 'the split character is dropped whole');
	t.true(output.includes('... [Output truncated: 3 bytes omitted]'));
	t.true(output.endsWith('x'));
});
