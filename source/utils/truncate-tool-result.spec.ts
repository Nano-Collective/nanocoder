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
