import test from 'ava';
import { formatForSpeech } from './format-for-speech.js';

test('strips ANSI escape codes', t => {
	const input = 'Hello \x1B[31mWorld\x1B[0m!';
	const result = formatForSpeech(input);
	t.is(result, 'Hello World!');
});

test('collapses fenced code blocks > 3 lines', t => {
	const input =
		'Here is some code:\n```typescript\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n```\nDone.';
	const result = formatForSpeech(input);
	t.is(result, 'Here is some code:\n[code block, 4 lines]\nDone.');
});

test('keeps fenced code blocks <= 3 lines', t => {
	const input =
		'Here is some code:\n```typescript\nconst a = 1;\nconst b = 2;\n```\nDone.';
	const result = formatForSpeech(input);
	t.is(result, 'Here is some code:\nconst a = 1;\nconst b = 2;\nDone.');
});

test('collapses stack traces', t => {
	const input =
		'An error occurred:\nTypeError: something went wrong\n    at Object.<anonymous> (/file.js:1:1)\n    at Module._compile (module.js:1:1)\nAnd that is it.';
	const result = formatForSpeech(input);
	t.is(
		result,
		'An error occurred:\nTypeError: something went wrong\n[stack trace, 2 frames]\nAnd that is it.',
	);
});

test('strips markdown headings, bold, italic, links, blockquotes, and lists', t => {
	const input =
		'# Heading 1\n## Heading 2\nThis is **bold** and *italic*.\nHere is a [link](https://example.com).\n> Blockquote\n- Item 1\n* Item 2\n1. Item 3';
	const result = formatForSpeech(input);
	t.is(
		result,
		'Heading 1\nHeading 2\nThis is bold and italic.\nHere is a link.\nBlockquote\nItem 1\nItem 2\nItem 3',
	);
});

test('abbreviates long absolute file paths', t => {
	const inputPosix =
		'File is at /users/username/projects/nanocoder/src/index.ts';
	const resultPosix = formatForSpeech(inputPosix);
	t.is(resultPosix, 'File is at /users/.../index.ts');

	const inputWindows =
		'File is at C:\\Users\\username\\projects\\nanocoder\\src\\index.ts';
	const resultWindows = formatForSpeech(inputWindows);
	t.is(resultWindows, 'File is at C:\\Users\\...\\index.ts');
});

test('normalizes whitespace', t => {
	const input = 'Hello   world.\n\n\nHow are you?';
	const result = formatForSpeech(input);
	t.is(result, 'Hello world.\nHow are you?');
});

test('truncates to max length', t => {
	const input = 'A'.repeat(600);
	const result = formatForSpeech(input, { maxLength: 500 });
	t.true(result.startsWith('A'.repeat(500)));
	t.true(result.includes('characters omitted]'));
});
