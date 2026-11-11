import test from 'ava';
import {truncateToolResult} from './truncate-tool-result.js';

test('leaves results at or below the cap unchanged', t => {
	const content = 'short result';

	t.is(truncateToolResult(content, content.length), content);
	t.is(truncateToolResult(content, content.length + 1), content);
});

test('keeps both ends of an oversized result within the cap', t => {
	const maxLength = 240;
	const content = `HEAD\n${'middle\n'.repeat(200)}TAIL`;

	const result = truncateToolResult(content, maxLength);

	t.is(result.length, maxLength);
	t.true(result.startsWith('HEAD\n'));
	t.true(result.endsWith('TAIL'));
	t.regex(
		result,
		/Output truncated: \d+ characters total; request a narrower result/,
	);
});

test('uses an empty result for a non-positive cap', t => {
	t.is(truncateToolResult('content', 0), '');
	t.is(truncateToolResult('content', -1), '');
});

test('never splits a placeholder token at the truncation boundary', t => {
	const maxLength = 240;
	// Placeholder tokens packed edge-to-edge with no gaps, so both the head
	// and tail cut points are guaranteed to land inside one somewhere in the
	// string unless the boundary is placeholder-aware.
	let content = '';
	let i = 0;
	while (content.length < 2000) {
		content += `«Email_${i}»`;
		i++;
	}

	const result = truncateToolResult(content, maxLength);

	t.true(result.length <= maxLength);
	// Every opening guillemet in the result belongs to a whole, well-formed
	// token — never left dangling by a cut through its middle.
	t.is(
		(result.match(/«/g) ?? []).length,
		(result.match(/«[A-Za-z]+_\d+»/g) ?? []).length,
	);
});

test('never splits an emoji surrogate pair at the truncation boundary', t => {
	const content = '😀'.repeat(2000);
	for (let maxLength = 300; maxLength < 420; maxLength++) {
		const result = truncateToolResult(content, maxLength);
		t.true(result.isWellFormed(), `maxLength ${maxLength}`);
		t.true(result.length <= maxLength, `maxLength ${maxLength}`);
		t.true(result.startsWith('😀'), `maxLength ${maxLength}`);
		t.true(result.endsWith('😀'), `maxLength ${maxLength}`);
	}
});

test('never splits a CJK extension B surrogate pair at the truncation boundary', t => {
	const content = '\u{20000}'.repeat(3000);
	for (let maxLength = 300; maxLength < 420; maxLength++) {
		const result = truncateToolResult(content, maxLength);
		t.true(result.isWellFormed(), `maxLength ${maxLength}`);
		t.true(result.length <= maxLength, `maxLength ${maxLength}`);
		t.true(result.startsWith('\u{20000}'), `maxLength ${maxLength}`);
		t.true(result.endsWith('\u{20000}'), `maxLength ${maxLength}`);
	}
});

test('leaves ordinary ASCII truncation behaviour unchanged', t => {
	const maxLength = 240;
	const sentence = 'An ordinary ASCII sentence. ';
	const content = sentence.repeat(100);

	const result = truncateToolResult(content, maxLength);

	t.is(
		result,
		'An ordinary ASCII sentence. An ordinary ASCII ' +
			'\n... [Output truncated: 2800 characters total; request a narrower result to inspect omitted content] ...\n' +
			'ordinary ASCII sentence. An ordinary ASCII sentence. An ordinary ASCII sentence. ',
	);
});

test('leaves content at or below the cap unchanged, including astral text', t => {
	const ascii = 'An ordinary sentence that fits.';
	const astral = '🔒\u{20000}'.repeat(10);

	t.is(truncateToolResult(ascii, ascii.length), ascii);
	t.is(truncateToolResult(astral, astral.length), astral);
	t.is(truncateToolResult(astral, astral.length + 1), astral);
});

test('does not cut through a whitespace-delimited token (a secret stays whole or goes)', t => {
	const secret = 'sk-live-abcdef1234567890abcdef1234567890';
	for (let offset = 700; offset < 760; offset++) {
		const content = `${'A'.repeat(offset)} ${secret} ${'B'.repeat(5000)} ${secret} ${'C'.repeat(offset)}`;
		const result = truncateToolResult(content, 2000);
		// Every occurrence that survives is the complete secret, never a prefix
		// or suffix a scrubber would no longer recognise.
		for (const fragment of result.match(/\S*sk-live\S*/g) ?? []) {
			t.is(fragment, secret, `offset ${offset}`);
		}
		for (const fragment of result.match(/\S*567890\S*/g) ?? []) {
			t.true(fragment === secret, `offset ${offset}: ${fragment}`);
		}
	}
});
