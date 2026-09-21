import test from 'ava';
import {resolve, sep} from 'node:path';
import stringWidth from 'string-width';
import {homeRelative, truncateMiddle} from './path.js';

const HOME = resolve('/Users/will');

test('homeRelative shortens a path inside home to a tilde form', t => {
	const input = resolve('/Users/will/projects/app');
	t.is(homeRelative(input, HOME), `~${sep}projects${sep}app`);
});

test('homeRelative returns a bare tilde for the home directory itself', t => {
	t.is(homeRelative(resolve('/Users/will'), HOME), '~');
});

test('homeRelative does not mangle a sibling directory that shares a prefix', t => {
	const input = resolve('/Users/willy/projects/app');
	t.is(homeRelative(input, HOME), input);
});

test('homeRelative leaves unrelated paths untouched', t => {
	const input = resolve('/etc/config');
	t.is(homeRelative(input, HOME), input);
});

test('homeRelative leaves paths untouched when home is the filesystem root', t => {
	const root = resolve('/');
	const child = resolve('/foo');
	t.is(homeRelative(child, root), child);
	t.is(homeRelative(root, root), root);
});

test('truncateMiddle degrades to a bare slice when the budget is tiny', t => {
	// Narrower than the ellipsis itself: there is nothing to signal elision
	// with, so it keeps whole characters that fit and nothing more.
	t.is(truncateMiddle('功能功能', 2), '功');
	t.is(truncateMiddle('功能功能', 1), '', 'a wide glyph does not fit one column');
	t.is(truncateMiddle('abcdef', 3), 'abc');
	t.is(truncateMiddle('abcdef', 0), '');
});

test('truncateMiddle budgets terminal columns, not characters', t => {
	// A CJK character is one code unit but two columns, so a length-based
	// budget lets the text run twice as wide as the row it has to fit.
	const branch = '功能'.repeat(10);
	t.is(branch.length, 20);
	t.is(stringWidth(branch), 40);

	const result = truncateMiddle(branch, 16);
	t.true(
		stringWidth(result) <= 16,
		`result occupies ${stringWidth(result)} columns, budget was 16`,
	);
	t.true(result.includes('...'));
});

test('truncateMiddle does not cut an emoji in half', t => {
	// Slicing by code unit splits a surrogate pair and the terminal renders
	// the replacement glyph.
	// The odd leading character pushes the slice boundary into a pair.
	const result = truncateMiddle(`a${'🚀'.repeat(10)}`, 11);
	t.true(stringWidth(result) <= 11);
	t.notRegex(
		result,
		/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
		'a lone surrogate means an emoji was split',
	);
});

test('truncateMiddle leaves short strings untouched', t => {
	t.is(truncateMiddle('/short/path', 40), '/short/path');
});

test('truncateMiddle keeps both the root and the leaf segment', t => {
	const long = '/Users/will/projects/some-really-long-monorepo-name/src/index.ts';
	const result = truncateMiddle(long, 30);
	t.is(result.length, 30);
	t.true(result.startsWith('/Users/wi'));
	t.true(result.endsWith('index.ts'));
	t.true(result.includes('...'));
});
