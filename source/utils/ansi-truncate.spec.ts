import test from 'ava';
import {truncateAnsi} from './ansi-truncate';

test('returns original string if within maxWidth', t => {
	t.is(truncateAnsi('hello', 10), 'hello');
});

test('truncates plain text and appends ellipsis', t => {
	const result = truncateAnsi('hello world', 6);
	t.true(result.endsWith('…'));
	t.false(result.includes('world'));
});

test('preserves ANSI codes while counting only visible chars', t => {
	const red = '\x1b[31m';
	const reset = '\x1b[0m';
	const input = `${red}hello world${reset}`;
	// maxWidth 6 means 5 visible chars + ellipsis
	const result = truncateAnsi(input, 6);
	// Should contain the red ANSI code
	t.true(result.includes(red));
	// Should end with reset + ellipsis
	t.true(result.endsWith('\x1b[0m…'));
});

test('returns string unchanged if ANSI codes make it look long but visible chars fit', t => {
	const bold = '\x1b[1m';
	const reset = '\x1b[0m';
	const input = `${bold}hi${reset}`;
	t.is(truncateAnsi(input, 10), input);
});

test('handles string with no ANSI codes', t => {
	const result = truncateAnsi('abcdefghij', 5);
	t.true(result.endsWith('…'));
});

test('handles empty string', t => {
	t.is(truncateAnsi('', 10), '');
});

test('handles maxWidth of 1', t => {
	const result = truncateAnsi('hello', 1);
	t.true(result.endsWith('…'));
});
