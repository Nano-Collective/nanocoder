import test from 'ava';
import {truncateHeadAndTail} from './truncate-output';

test('returns original string if within the limit', t => {
	t.is(truncateHeadAndTail('hello', 100), 'hello');
});

test('returns original string if exactly at the limit', t => {
	const text = 'x'.repeat(100);
	t.is(truncateHeadAndTail(text, 100), text);
});

test('keeps both head and tail when over the limit', t => {
	const head = 'HEAD'.repeat(50); // 200 chars
	const middle = 'M'.repeat(1000);
	const tail = 'TAIL'.repeat(50); // 200 chars
	const result = truncateHeadAndTail(head + middle + tail, 300);

	t.true(result.startsWith(head.slice(0, 10)), 'Should keep the start of the head');
	t.true(result.endsWith(tail.slice(-10)), 'Should keep the end of the tail');
	t.true(result.includes('characters elided'), 'Should mark that content was elided');
});

test('gives the tail a larger share of the budget than the head', t => {
	const text = 'x'.repeat(10_000);
	const result = truncateHeadAndTail(text, 2000);

	const parts = result.split(/\n\.\.\. \[Output truncated: \d+ characters elided\] \.\.\.\n/);
	t.is(parts.length, 2, 'Should split cleanly into a head and a tail around the marker');
	const [head, tail] = parts;

	t.true(head.length < tail.length, 'Tail should be the larger share');
	t.is(head.length, 800);
	t.is(tail.length, 1200);
});

test('does not truncate output shorter than the limit even with unusual content', t => {
	const text = 'a\nb\nc';
	t.is(truncateHeadAndTail(text, 10), text);
});
