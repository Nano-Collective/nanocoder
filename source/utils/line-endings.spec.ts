import test from 'ava';
import {
	detectLineEnding,
	fitEditToLineEndings,
	toLineEnding,
} from './line-endings';

console.log(`\nline-endings.spec.ts`);

test('detectLineEnding: picks the ending most lines use', t => {
	t.is(detectLineEnding('a\r\nb\r\nc\n'), '\r\n');
	t.is(detectLineEnding('a\nb\nc\r\n'), '\n');
	t.is(detectLineEnding('a\r\nb\n'), '\n');
	t.is(detectLineEnding('no breaks'), '\n');
});

test('toLineEnding: converts LF and CRLF both ways', t => {
	t.is(toLineEnding('a\nb\r\nc', '\r\n'), 'a\r\nb\r\nc');
	t.is(toLineEnding('a\r\nb\nc', '\n'), 'a\nb\nc');
});

test('fitEditToLineEndings: leaves edits to LF files unchanged', t => {
	t.deepEqual(fitEditToLineEndings('a\nb\n', 'a\nb', 'x\r\ny'), {
		oldStr: 'a\nb',
		newStr: 'x\r\ny',
	});
});

test('fitEditToLineEndings: converts both strings for a CRLF file', t => {
	t.deepEqual(fitEditToLineEndings('a\r\nb\r\n', 'a\nb', 'x\ny'), {
		oldStr: 'a\r\nb',
		newStr: 'x\r\ny',
	});
});

test('fitEditToLineEndings: converts a single-line edit that adds lines', t => {
	t.deepEqual(fitEditToLineEndings('a\r\nb\r\n', 'b', 'b\nc'), {
		oldStr: 'b',
		newStr: 'b\r\nc',
	});
});

test('fitEditToLineEndings: keeps an LF edit that only matches an LF region', t => {
	const file = 'a\r\nb\r\nc\r\nx\ny\n';
	t.deepEqual(fitEditToLineEndings(file, 'x\ny', 'X\nY'), {
		oldStr: 'x\ny',
		newStr: 'X\nY',
	});
});
