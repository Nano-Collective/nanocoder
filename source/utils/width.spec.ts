import test from 'ava';
import {truncateByColumns, truncatePathByColumns, width} from '@/utils/width';

test('width counts ASCII as 1 column per character', t => {
	t.is(width('hello'), 5);
	t.is(width('  spaces  '), 10);
	t.is(width(''), 0);
});

test('width treats ambiguous East-Asian glyphs as narrow by default', t => {
	// ⚒ (U+2692), ⚠ (U+26A0), ❯ (U+276F), ✓ (U+2713) are East Asian
	// Ambiguous — string-width counts them as 1 column by default
	// (per UAX #11 default), which is what the rest of the CLI ecosystem
	// does.
	t.is(width('\u2692'), 1);
	t.is(width('\u26A0'), 1);
	t.is(width('\u276F'), 1);
	t.is(width('\u2713'), 1);
});

test('width counts CJK as 2 columns', t => {
	// 古 (CJK ideograph) and あ (hiragana) are full-width.
	t.is(width('古'), 2);
	t.is(width('あ'), 2);
	t.is(width('古文字'), 6);
});

test('width ignores ANSI escape codes', t => {
	// `string-width` strips ANSI when measuring, so the visible
	// characters count, not the escape bytes.
	t.is(width('\u001B[31mred\u001B[0m'), 3);
});

test('width counts emoji-modifier sequences as wide', t => {
	// ⚠️ (⚠ + VS-16) is a single emoji grapheme and renders as 2 columns.
	t.is(width('\u26A0\uFE0F'), 2);
});

test('truncateByColumns returns input unchanged when under the limit', t => {
	t.is(truncateByColumns('hello', 10), 'hello');
	t.is(truncateByColumns('', 5), '');
});

test('truncateByColumns appends the single-column ellipsis when over', t => {
	const out = truncateByColumns('this is a long string', 10);
	t.true(out.endsWith('\u2026'));
	// ellipsis is 1 column, so result fits exactly within 10 visual cols
	t.is(width(out), 10);
});

test('truncateByColumns respects visual columns, not code units', t => {
	// Two CJK glyphs are 2 cols each. With a budget of 5, we get one
	// full glyph + the ellipsis (2 + 1 = 3 < 5; two full = 4 < 5).
	const out = truncateByColumns('古古古古', 5);
	t.true(out.endsWith('\u2026'));
	t.is(width(out), 5);
});

test('truncateByColumns handles maxColumns smaller than the ellipsis', t => {
	// When the budget is too small even for the ellipsis, return an
	// empty string (no room for any glyph).
	const out = truncateByColumns('hello', 0);
	t.is(out, '');
});

test('truncatePathByColumns returns input unchanged when short enough', t => {
	t.is(truncatePathByColumns('/home/user', 20), '/home/user');
	t.is(truncatePathByColumns('', 5), '');
	t.is(truncatePathByColumns(undefined, 5), '');
});

test('truncatePathByColumns keeps the END of the path', t => {
	const long = '/home/user/documents/projects/myproject/src/components/Button.tsx';
	const out = truncatePathByColumns(long, 30);
	t.true(out.startsWith('\u2026'));
	t.true(out.endsWith('Button.tsx'));
	t.is(width(out), 30);
});

test('truncatePathByColumns never inflates a path past its budget', t => {
	// Even with CJK glyphs, the output column count must stay ≤ maxColumns.
	const out = truncatePathByColumns('/長い/パス/が/続いている/button.tsx', 12);
	t.true(out.startsWith('\u2026'));
	t.is(width(out), 12);
});