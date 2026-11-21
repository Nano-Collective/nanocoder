import test from 'ava';
import {
	snapOutsideSurrogate,
	truncateToolResult,
} from './truncate-tool-result.js';

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

test('snapOutsideSurrogate steps boundary away from surrogate pair splits', t => {
	// 'abc' (0,1,2), '\u{1F600}' -> \uD83D (3), \uDE00 (4), 'def' (5,6,7)
	const text = 'abc\u{1F600}def';

	// Cut at index 4 splits the pair. 'before' steps back to 3, keeping 'abc'.
	t.is(snapOutsideSurrogate(text, 4, 'before'), 3);
	t.is(text.slice(0, snapOutsideSurrogate(text, 4, 'before')), 'abc');

	// Cut at index 4 with 'after' steps forward to 5, keeping 'def'.
	t.is(snapOutsideSurrogate(text, 4, 'after'), 5);
	t.is(text.slice(snapOutsideSurrogate(text, 4, 'after')), 'def');

	// Cuts already outside the pair remain unchanged.
	t.is(snapOutsideSurrogate(text, 3, 'before'), 3);
	t.is(snapOutsideSurrogate(text, 5, 'before'), 5);
	t.is(snapOutsideSurrogate(text, 3, 'after'), 3);
	t.is(snapOutsideSurrogate(text, 5, 'after'), 5);

	// Edge boundaries (0, length) are bounds-safe.
	t.is(snapOutsideSurrogate(text, 0, 'before'), 0);
	t.is(snapOutsideSurrogate(text, text.length, 'after'), text.length);
});

test('never cuts a surrogate pair in half (zero lone surrogates)', t => {
	const loneSurrogatePattern =
		/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

	// Astral characters without whitespace nearby (where snapOutsideToken cannot intervene)
	for (let len = 3000; len < 3040; len++) {
		const s = '\u{1F600}'.repeat(len);
		for (const max of [1000, 1001, 2000, 2001, 2500]) {
			const truncated = truncateToolResult(s, max);
			t.false(
				loneSurrogatePattern.test(truncated),
				`Lone surrogate found for len ${len}, max ${max}`,
			);
			t.true(truncated.length <= max);
		}
	}
});

test('preserves surrogate pairs when cut boundary falls on arbitrary lengths', t => {
	const loneSurrogatePattern =
		/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

	const emojiRun = '🌟🎉🚀🔥'.repeat(500);
	for (let max = 150; max < 250; max++) {
		const truncated = truncateToolResult(emojiRun, max);
		t.false(loneSurrogatePattern.test(truncated), `max ${max}`);
		t.true(truncated.length <= max);
	}
});
