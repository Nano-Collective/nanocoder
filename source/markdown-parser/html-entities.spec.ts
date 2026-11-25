import test from 'ava';
import {decodeHtmlEntities} from './html-entities.js';

console.log(`\nhtml-entities.spec.ts`);

test('decodeHtmlEntities handles common entities', t => {
	const text = 'Hello&nbsp;World &amp; Friends';
	const result = decodeHtmlEntities(text);
	t.is(result, 'Hello World & Friends');
});

test('decodeHtmlEntities handles less-than and greater-than', t => {
	const text = '&lt;div&gt;';
	const result = decodeHtmlEntities(text);
	t.is(result, '<div>');
});

test('decodeHtmlEntities handles quotes', t => {
	const text = '&quot;Hello&quot; &apos;World&apos;';
	const result = decodeHtmlEntities(text);
	t.is(result, '"Hello" \'World\'');
});

test('decodeHtmlEntities handles copyright and trademark symbols', t => {
	const text = '&copy; 2024 &reg; &trade;';
	const result = decodeHtmlEntities(text);
	t.is(result, '© 2024 ® ™');
});

test('decodeHtmlEntities handles currency symbols', t => {
	const text = '&euro; &pound; &yen; &cent;';
	const result = decodeHtmlEntities(text);
	t.is(result, '€ £ ¥ ¢');
});

test('decodeHtmlEntities handles mathematical symbols', t => {
	const text = '&sect; &deg; &plusmn; &times; &divide;';
	const result = decodeHtmlEntities(text);
	t.is(result, '§ ° ± × ÷');
});

test('decodeHtmlEntities handles typography symbols', t => {
	const text =
		'&ndash; &mdash; &lsquo;text&rsquo; &ldquo;text&rdquo; &hellip; &bull;';
	const result = decodeHtmlEntities(text);
	t.is(result, '– — \u2018text\u2019 \u201Ctext\u201D … •');
});

test('decodeHtmlEntities handles numeric entities (decimal)', t => {
	const text = '&#160;&#169;';
	const result = decodeHtmlEntities(text);
	t.is(result, '\u00A0©');
});

test('decodeHtmlEntities handles numeric entities (hexadecimal)', t => {
	const text = '&#xA0;&#xA9;';
	const result = decodeHtmlEntities(text);
	t.is(result, '\u00A0©');
});

test('decodeHtmlEntities handles mixed entities', t => {
	const text = '&lt;div&gt; &#169; &#xA9; &copy;';
	const result = decodeHtmlEntities(text);
	t.is(result, '<div> © © ©');
});

test('decodeHtmlEntities leaves normal text unchanged', t => {
	const text = 'Hello World! This is normal text.';
	const result = decodeHtmlEntities(text);
	t.is(result, text);
});

test('decodeHtmlEntities handles multiple occurrences of same entity', t => {
	const text = '&amp;&amp;&amp;';
	const result = decodeHtmlEntities(text);
	t.is(result, '&&&');
});

test('decodeHtmlEntities handles empty string', t => {
	const result = decodeHtmlEntities('');
	t.is(result, '');
});

test('decodeHtmlEntities handles entities in context', t => {
	const text = 'The price is &pound;50 &amp; the tax is &euro;10.';
	const result = decodeHtmlEntities(text);
	t.is(result, 'The price is £50 & the tax is €10.');
});

test('decodeHtmlEntities handles numeric entities above U+FFFF', t => {
	const text = '&#128512; &#x1F600;';
	const result = decodeHtmlEntities(text);
	t.is(result, '😀 😀');
});

test('decodeHtmlEntities decodes escaped entities only once', t => {
	const text = '&amp;lt; &amp;#169; &amp;amp;';
	const result = decodeHtmlEntities(text);
	t.is(result, '&lt; &#169; &amp;');
});

test('decodeHtmlEntities leaves invalid entities unchanged', t => {
	const text = '&#1114112; &#x110000; &foo;';
	const result = decodeHtmlEntities(text);
	t.is(result, text);
});
