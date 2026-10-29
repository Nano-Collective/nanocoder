import test from 'ava';
import {createTerminalInputFilter} from './terminal-input';
import type {InputSegment} from './terminal-paste';

const START = '\x1b[200~';
const END = '\x1b[201~';
const key = (text: string): InputSegment => ({kind: 'key', text});
const paste = (payload: string): InputSegment => ({kind: 'paste', payload});

function capture() {
	const input: InputSegment[] = [];
	const wheel: string[] = [];
	const filter = createTerminalInputFilter(
		segment => input.push(segment),
		direction => wheel.push(direction),
	);
	return {...filter, input, wheel};
}

test('keeps keys on both sides of a paste in order', t => {
	const filter = capture();
	t.teardown(filter.dispose);
	filter.push(`a${START}P${END}b`);
	t.deepEqual(filter.input, [key('a'), paste('P'), key('b')]);
});

test('keeps multiple pastes and control keys in order', t => {
	const filter = capture();
	t.teardown(filter.dispose);
	filter.push(`a\x7f${START}one${END}b${START}${END}\x7fc`);
	t.deepEqual(filter.input, [
		key('a'), key('\x7f'), paste('one'), key('b'), paste(''), key('\x7f'), key('c'),
	]);
});

test('keeps fragmented paste markers and payloads between surrounding keys', t => {
	const stream = `a${START}payload${END}b`;
	// The extractor deliberately does not hold a lone ESC or ESC[ as a paste prefix.
	for (let boundary = 4; boundary < stream.length; boundary++) {
		const filter = capture();
		filter.push(stream.slice(0, boundary));
		filter.push(stream.slice(boundary));
		t.deepEqual(filter.input, [key('a'), paste('payload'), key('b')], `boundary ${boundary}`);
		filter.dispose();
	}
});

test('flushes a held modified Enter before a paste without a later duplicate', async t => {
	const filter = capture();
	t.teardown(filter.dispose);
	filter.push('a\x1b[27;');
	filter.push(`${START}P${END}b`);
	const expected = [key('a'), key('\x1b[27;'), paste('P'), key('b')];
	t.deepEqual(filter.input, expected);
	await new Promise(resolve => setTimeout(resolve, 50));
	t.deepEqual(filter.input, expected);
});

test('rewrites split modified Enter on either side of a paste', t => {
	const filter = capture();
	t.teardown(filter.dispose);
	filter.push('\x1b[27;2;');
	filter.push(`13~${START}P${END}\x1b[27;3;`);
	filter.push('13~');
	t.deepEqual(filter.input, [key('\x1b[13;2u'), paste('P'), key('\x1b[13;3u')]);
});

test('leaves paste payloads opaque while stripping surrounding mouse reports', t => {
	const filter = capture();
	t.teardown(filter.dispose);
	const payload = '\x1b[27;2;13~\x1b[<64;1;1M\r\n';
	filter.push(`a\x1b[<64;1;1M${START}${payload}${END}\x1b[<65;1;1Mb`);
	t.deepEqual(filter.input, [key('a'), paste(payload), key('b')]);
	t.deepEqual(filter.wheel, ['up', 'down']);
});

test('does not carry a partial mouse sequence across a paste', t => {
	const filter = capture();
	t.teardown(filter.dispose);
	filter.push('\x1b[<64;');
	filter.push(`${START}P${END}1;1M`);
	t.deepEqual(filter.input, [key('\x1b[<64;'), paste('P'), key('1;1M')]);
	t.deepEqual(filter.wheel, []);
});

test('decodes split UTF-8 next to a paste without replacement characters', t => {
	const filter = capture();
	t.teardown(filter.dispose);
	const bytes = Buffer.from(`😀${START}P${END}b`);
	filter.push(bytes.subarray(0, 2));
	filter.push(bytes.subarray(2));
	t.deepEqual(filter.input, [key('😀'), paste('P'), key('b')]);
});

test('disposing cancels held input', async t => {
	const filter = capture();
	filter.push('\x1b[27;');
	filter.dispose();
	await new Promise(resolve => setTimeout(resolve, 50));
	t.deepEqual(filter.input, []);
});
