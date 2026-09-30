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
