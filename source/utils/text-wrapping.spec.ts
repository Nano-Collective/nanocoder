import test from 'ava';
import {wrapWithTrimmedContinuations} from './text-wrapping';

test('returns text unchanged if width <= 0', t => {
	t.is(wrapWithTrimmedContinuations('hello world', 0), 'hello world');
	t.is(wrapWithTrimmedContinuations('hello world', -1), 'hello world');
});

test('preserves empty lines', t => {
	const result = wrapWithTrimmedContinuations('hello\n\nworld', 80);
	t.is(result, 'hello\n\nworld');
});

test('wraps long lines at the given width', t => {
	const result = wrapWithTrimmedContinuations('aaa bbb ccc', 7);
	const lines = result.split('\n');
	t.true(lines.length > 1);
});

test('trims wrap-artifact leading spaces from continuation lines', t => {
	// "aaa bbb" wrapped at width 4 would split at the space, leaving " bbb"
	// Our function should trim that leading space artifact
	const result = wrapWithTrimmedContinuations('aaa bbb', 4);
	const lines = result.split('\n');
	for (let i = 1; i < lines.length; i++) {
		// Continuation lines should not start with a single artifact space
		// (they may start with intentional indentation, but not a wrap artifact)
		t.false(lines[i].startsWith(' ') && lines[i].trimStart() === lines[i].slice(1));
	}
});

test('handles multiline input correctly', t => {
	const input = 'line one\nline two\nline three';
	const result = wrapWithTrimmedContinuations(input, 80);
	t.is(result, input);
});

test('handles single character width with hard wrap', t => {
	const result = wrapWithTrimmedContinuations('ab', 1);
	const lines = result.split('\n');
	t.true(lines.length >= 2);
});
