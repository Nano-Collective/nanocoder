import test from 'ava';
import {truncateText} from './truncate-text';

console.log('\ntruncate-text.spec.ts');

test('text that fits is returned unchanged', t => {
	t.is(truncateText('hello', 5), 'hello');
	t.is(truncateText('', 0), '');
	t.is(truncateText('héllo', 5, {unit: 'code-units'}), 'héllo');
});

test('cut text ends with the ellipsis and fits max', t => {
	t.is(truncateText('hello world', 6), 'hello…');
	t.is(truncateText('hello world', 6, {unit: 'code-units'}), 'hello…');
	t.is(truncateText('hello world', 8, {ellipsis: '...'}), 'hello...');
});

test('an empty ellipsis is a hard cut', t => {
	t.is(truncateText('hello world', 5, {ellipsis: ''}), 'hello');
});

test('code points count an emoji as one; code units as two', t => {
	const text = '😀😀😀😀';
	t.is(truncateText(text, 4), text);
	t.is(truncateText(text, 3), '😀😀…');
	t.is(truncateText(text, 4, {unit: 'code-units'}), '😀…');
	t.is(truncateText(text, 8, {unit: 'code-units'}), text);
});

test('a code-unit cut never leaves half of a surrogate pair', t => {
	// Five units: 'a', then two emoji of two units each. A cut at 2 lands
	// between the halves of the first emoji.
	const text = 'a😀😀';
	t.is(truncateText(text, 3, {unit: 'code-units'}), 'a…');
	t.is(truncateText(text, 2, {unit: 'code-units', ellipsis: ''}), 'a');
	for (let max = 0; max <= text.length; max++) {
		const out = truncateText(text, max, {unit: 'code-units'});
		t.true(out.length <= max, `max ${max}`);
		t.true(out.isWellFormed(), `max ${max}: ${JSON.stringify(out)}`);
	}
});

test('a max with no room beside the ellipsis hard-cuts', t => {
	t.is(truncateText('hello', 1), 'h');
	t.is(truncateText('hello', 0), '');
	t.is(truncateText('hello', -3), '');
	t.is(truncateText('hello', 3, {ellipsis: '...'}), 'hel');
});
