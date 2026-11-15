import {createRequire} from 'node:module';
import test from 'ava';
import stripAnsi from 'strip-ansi';
import {highlight} from './highlighter.js';

const req = createRequire(import.meta.url);
const isCliHighlightLoaded = () =>
	Boolean(req.cache?.[req.resolve('cli-highlight')]);

test.serial('highlight loads cli-highlight lazily on first use', t => {
	t.false(isCliHighlightLoaded());

	const code = 'const hello = "world";';
	const result = highlight(code, {language: 'javascript'});

	t.true(isCliHighlightLoaded());
	t.is(stripAnsi(result), code);
	t.is(typeof result, 'string');
});

test.serial('highlight handles code with options', t => {
	const code = 'function add(a, b) { return a + b; }';
	const result = highlight(code, {language: 'javascript'});

	t.is(stripAnsi(result), code);
});

test.serial('highlight handles plaintext or unspecified language', t => {
	const text = 'simple plain text without formatting';
	const result = highlight(text, {language: 'plaintext'});

	t.is(stripAnsi(result), text);
});
