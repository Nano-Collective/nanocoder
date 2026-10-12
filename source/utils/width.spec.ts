import test from 'ava';
import {width} from '@/utils/width';

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
